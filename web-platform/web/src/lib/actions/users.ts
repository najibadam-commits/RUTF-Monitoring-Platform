"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, type Profile } from "@/lib/supabase/dal";
import { assignableRolesFor, canAccessProjectAdminPanel, canAccessUsersScreen } from "@/lib/rbac";
import type { UserRole } from "@/lib/types/database";

type ActionResult = { error?: string };

/**
 * Profile columns that follow from the role. A facility user (`dri`) is tied to one facility
 * (RUTF brief §4, migration 0100); its level (assigned_category_id) is then set by the database
 * from the facility type, so it is left out here for a dri and cleared for every other role.
 * A dri also takes the facility's project, so a Super Admin assignment lands in the right scope.
 */
async function roleScopedColumns(
  client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>,
  input: { role: UserRole; managedStateId?: string | null; facilityId?: string | null; supervisionLevel?: string | null },
): Promise<{ error?: string; columns?: Record<string, string | null> }> {
  const columns: Record<string, string | null> = {
    managed_state_id: input.role === "state_coordinator" ? (input.managedStateId ?? null) : null,
    facility_id: input.role === "dri" ? (input.facilityId ?? null) : null,
    supervision_level: input.role === "tpm_supervisor" ? (input.supervisionLevel ?? null) : null,
  };
  if (input.role !== "dri") columns.assigned_category_id = null;
  if (input.role === "dri" && input.facilityId) {
    const { data: facility, error } = await client.from("facilities").select("project_id").eq("id", input.facilityId).single();
    if (error || !facility) return { error: "That facility wasn't found." };
    if (facility.project_id) columns.project_id = facility.project_id;
  }
  return { columns };
}

type SupervisionInput = { role: UserRole; supervisionLevel?: string | null; supervisedLgaIds?: string[] };

/** A supervisor needs a level and, for OTP sites, at least one LGA (RUTF DECISIONS R34). */
function validateSupervision(input: SupervisionInput): string | null {
  if (input.role !== "tpm_supervisor") return null;
  if (input.supervisionLevel !== "stores" && input.supervisionLevel !== "otp_sites") return "Select what this supervisor supervises.";
  if (input.supervisionLevel === "otp_sites" && !input.supervisedLgaIds?.length) return "Select the LGA(s) whose OTP sites this supervisor covers.";
  return null;
}

/** Replaces a supervisor's LGAs (supervisor_lgas, migration 0103); clears them for other roles. */
async function setSupervisorLgas(
  client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: SupervisionInput,
): Promise<string | null> {
  const { error: delError } = await client.from("supervisor_lgas").delete().eq("profile_id", userId);
  if (delError) return delError.message;
  const ids = input.role === "tpm_supervisor" ? [...new Set(input.supervisedLgaIds ?? [])] : [];
  if (ids.length) {
    const { error } = await client.from("supervisor_lgas").insert(ids.map((lga_id) => ({ profile_id: userId, lga_id })));
    if (error) return error.message;
  }
  return null;
}

/**
 * Shared by addUserAction and bulkAddUsersAction: invites one account via the
 * service-role Admin API (inviteUserByEmail — a real email with a link to set
 * their own password) then corrects role/project_id with the same admin
 * client — see DECISIONS.md #4 for why this can't go through the normal
 * RLS-respecting client. Caller-level authorization (canAccessUsersScreen) is
 * checked once by the calling action, not here — this only re-validates the
 * per-row role-assignability rule, since a bulk caller might submit a row
 * whose role they're not allowed to assign even if they can reach the screen.
 */
async function inviteAndSetupUser(
  admin: ReturnType<typeof createAdminClient>,
  caller: Profile,
  input: {
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    // Only meaningful for role = state_coordinator / role = dri respectively — see
    // DECISIONS.md #22 and RUTF DECISIONS R15. Undefined/omitted for every other role.
    managedStateId?: string | null;
    facilityId?: string | null;
    supervisionLevel?: string | null;
    supervisedLgaIds?: string[];
  },
  // Explicit override for callers that already know the target project (e.g. the Project
  // Admin bulk import, which just created/resolved one). Omit to fall back to the normal
  // inherit-from-caller behavior below.
  projectIdOverride?: string | null,
): Promise<ActionResult> {
  if (!assignableRolesFor(caller.role).includes(input.role)) return { error: `You cannot assign the ${input.role} role.` };
  if (!input.name.trim() || !input.email.trim()) return { error: "Name and email are required." };
  if (input.role === "state_coordinator" && !input.managedStateId) return { error: "Select the State this coordinator will manage." };
  if (input.role === "dri" && !input.facilityId) return { error: "Select the facility this facility user records for." };
  const supervisionError = validateSupervision(input);
  if (supervisionError) return { error: supervisionError };
  const scoped = await roleScopedColumns(admin, input);
  if (scoped.error) return { error: scoped.error };

  // redirectTo must point at /auth/confirm (not Supabase's default Site URL redirect, which never
  // hits our own token_hash-exchange route) — without it the invite link lands the user back on
  // /login with no session and no way to set a password, exactly like resetUserPasswordAction
  // and tools/db/invite-super-admin.js already correctly do below/elsewhere.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { name: input.name },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm?next=/auth/update-password`,
  });
  if (error || !data.user) return { error: error?.message ?? "Failed to create the account." };

  const projectId = projectIdOverride !== undefined ? projectIdOverride : caller.role === "project_admin" ? caller.project_id : null;
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      name: input.name,
      phone: input.phone || null,
      role: input.role,
      project_id: projectId,
      ...scoped.columns,
    })
    .eq("id", data.user.id);
  if (profileError) return { error: profileError.message };
  const lgaError = await setSupervisorLgas(admin, data.user.id, input);
  if (lgaError) return { error: lgaError };

  return {};
}

/** Add a user (Users & Access screen) — single-account path, see inviteAndSetupUser above. */
export async function addUserAction(input: {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  managedStateId?: string | null;
  facilityId?: string | null;
  supervisionLevel?: string | null;
  supervisedLgaIds?: string[];
}): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role)) return { error: "Not authorized." };

  const admin = createAdminClient();
  const result = await inviteAndSetupUser(admin, caller, input);
  if (result.error) return result;

  revalidatePath("/users");
  return {};
}

const BULK_INVITE_MAX_ROWS = 25;
const BULK_INVITE_DELAY_MS = 400;

/**
 * Bulk Import (Users & Access screen) — generic, column-mapped CSV import. Each row is its own
 * Supabase Auth Admin API call (inviteUserByEmail), not a batchable table insert like the
 * Master Data bulk actions, so this processes rows sequentially with a small delay between them
 * and reports a per-row result rather than failing the whole batch on one row's error. The row
 * cap and delay are deliberately conservative: this project has previously hit Supabase's email
 * rate limit from repeated invites (see tools/db/add-user-no-email.js's own comment about it).
 */
export async function bulkAddUsersAction(
  rows: { name: string; email: string; phone: string; role: UserRole; facilityId?: string | null }[],
): Promise<{ error?: string; results?: { email: string; success: boolean; error?: string }[] }> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role)) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to import." };
  if (rows.length > BULK_INVITE_MAX_ROWS) {
    return { error: `Up to ${BULK_INVITE_MAX_ROWS} rows at a time — this avoids triggering Supabase's email rate limit. Split larger files into smaller batches.` };
  }

  const admin = createAdminClient();
  const results: { email: string; success: boolean; error?: string }[] = [];
  let anySuccess = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await inviteAndSetupUser(admin, caller, row);
    if (result.error) {
      results.push({ email: row.email, success: false, error: result.error });
    } else {
      results.push({ email: row.email, success: true });
      anySuccess = true;
    }
    if (i < rows.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BULK_INVITE_DELAY_MS));
    }
  }

  if (anySuccess) revalidatePath("/users");
  return { results };
}

export async function editUserAction(input: {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: "active" | "inactive";
  managedStateId?: string | null;
  facilityId?: string | null;
  supervisionLevel?: string | null;
  supervisedLgaIds?: string[];
}): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role)) return { error: "Not authorized." };
  if (input.role === "state_coordinator" && !input.managedStateId) return { error: "Select the State this coordinator will manage." };
  if (input.role === "dri" && !input.facilityId) return { error: "Select the facility this facility user records for." };
  const supervisionError = validateSupervision(input);
  if (supervisionError) return { error: supervisionError };

  // Regular (RLS-respecting) client: the enforce_profile_update_rules
  // trigger is the real boundary here (project scope, role-escalation guard,
  // and a Project Admin may only assign a facility in their own project).
  const supabase = await createClient();
  const scoped = await roleScopedColumns(supabase, input);
  if (scoped.error) return { error: scoped.error };
  const { error } = await supabase
    .from("profiles")
    .update({
      name: input.name,
      email: input.email,
      phone: input.phone || null,
      role: input.role,
      status: input.status,
      ...scoped.columns,
    })
    .eq("id", input.userId);
  if (error) return { error: error.message };
  // RLS: a Project Admin can set the LGAs of supervisors in their own project only.
  const lgaError = await setSupervisorLgas(supabase, input.userId, input);
  if (lgaError) return { error: lgaError };

  revalidatePath("/users");
  return {};
}

export async function removeUserAction(userId: string, mode: "deactivate" | "delete"): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role)) return { error: "Not authorized." };

  if (mode === "deactivate") {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ status: "inactive" }).eq("id", userId);
    if (error) return { error: error.message };
  } else {
    if (caller.role !== "super_admin") return { error: "Only Super Admin can permanently remove a user." };
    if (userId === caller.id) return { error: "You cannot permanently remove your own account." };

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      // auth.admin.deleteUser wraps any foreign-key violation from the profiles(id) ON DELETE
      // CASCADE hitting a NO ACTION reference (issues/issue_history/etc.) in this same generic
      // message — migration 0031 switched every such reference to ON DELETE SET NULL specifically
      // so this shouldn't recur, but keep the friendlier wording as a safety net (and never leak
      // the raw Postgres/service-role error text to the browser).
      console.error(`removeUserAction: permanent delete failed for ${userId}:`, error.message);
      const message = /database error/i.test(error.message)
        ? "Unable to permanently remove this user because a database relationship is preventing deletion. Contact an administrator."
        : error.message;
      return { error: message };
    }
  }

  revalidatePath("/users");
  revalidatePath("/project-admins");
  return {};
}

export async function toggleUserStatusAction(userId: string): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role) && !canAccessProjectAdminPanel(caller.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("status").eq("id", userId).single();
  if (!target) return { error: "User not found." };

  const { error } = await supabase
    .from("profiles")
    .update({ status: target.status === "active" ? "inactive" : "active" })
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/users");
  revalidatePath("/project-admins");
  return {};
}

/** Reset password: sends a normal Supabase recovery email — no admin privileges required to trigger this for any account. */
export async function resetUserPasswordAction(email: string): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessUsersScreen(caller.role) && !canAccessProjectAdminPanel(caller.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm?next=/auth/update-password`,
  });
  if (error) return { error: error.message };
  return {};
}

/** Project Admin Panel — Super Admin only: creates a project + its Project Admin account together (see DECISIONS.md #2). */
export async function addProjectAdminAction(input: { name: string; email: string; phone: string; projectName: string }): Promise<ActionResult> {
  const caller = await getCurrentProfile();
  if (!canAccessProjectAdminPanel(caller.role)) return { error: "Not authorized." };
  if (!input.name.trim() || !input.email.trim() || !input.projectName.trim()) {
    return { error: "Name, email, and project name are required." };
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin.from("projects").insert({ name: input.projectName }).select("id").single();
  if (projectError) return { error: projectError.message };

  const { data: userData, error: userError } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { name: input.name },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm?next=/auth/update-password`,
  });
  if (userError || !userData.user) return { error: userError?.message ?? "Failed to create the account." };

  const { error: profileError } = await admin
    .from("profiles")
    .update({ name: input.name, phone: input.phone || null, role: "project_admin", project_id: project.id })
    .eq("id", userData.user.id);
  if (profileError) return { error: profileError.message };

  revalidatePath("/project-admins");
  return {};
}

/**
 * Bulk Import (Project Admin Panel) — same column-mapped CSV pattern as bulkAddUsersAction, but
 * each row also names a project. Per the product decision recorded in DECISIONS.md: rows sharing
 * the same (trimmed, case-insensitive) project name become multiple admins on ONE newly-created
 * project; different names each create their own new project. This never targets a pre-existing
 * project — every project this touches is one it just created in this same call.
 *
 * Same row cap/delay as bulkAddUsersAction: each row is still its own inviteUserByEmail Auth API
 * call, so the same email-rate-limit consideration applies.
 */
export async function bulkAddProjectAdminsAction(
  rows: { name: string; email: string; phone: string; projectName: string }[],
): Promise<{ error?: string; results?: { email: string; success: boolean; error?: string }[] }> {
  const caller = await getCurrentProfile();
  if (!canAccessProjectAdminPanel(caller.role)) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to import." };
  if (rows.length > BULK_INVITE_MAX_ROWS) {
    return { error: `Up to ${BULK_INVITE_MAX_ROWS} rows at a time — this avoids triggering Supabase's email rate limit. Split larger files into smaller batches.` };
  }

  const admin = createAdminClient();
  const results: { email: string; success: boolean; error?: string }[] = [];
  let anySuccess = false;
  let isFirstRow = true;

  // Group by normalized project name, preserving first-seen order, so rows sharing a project
  // land on one newly-created project row instead of one each.
  const groups = new Map<string, { projectName: string; rows: typeof rows }>();
  for (const row of rows) {
    const key = row.projectName.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { projectName: row.projectName.trim(), rows: [row] });
  }

  for (const { projectName, rows: groupRows } of groups.values()) {
    if (!projectName) {
      for (const row of groupRows) results.push({ email: row.email, success: false, error: "Project name is required." });
      continue;
    }

    let projectId: string;
    const { data: project, error: projectError } = await admin.from("projects").insert({ name: projectName }).select("id").single();
    if (project) {
      projectId = project.id;
    } else {
      // `projects.name` is unique — a collision here is either a real pre-existing project
      // (leave it alone, per the product decision that this feature never targets one) or an
      // orphan left behind by an earlier partial failure of this same bulk import (a project
      // row this function created whose invites all failed). Reuse the orphan so a corrected
      // retry isn't permanently blocked by its own previous attempt.
      const { data: existing } = await admin.from("projects").select("id").eq("name", projectName).maybeSingle();
      const { count } = existing
        ? await admin.from("profiles").select("id", { count: "exact", head: true }).eq("project_id", existing.id)
        : { count: null };
      if (existing && count === 0) {
        projectId = existing.id;
      } else if (existing) {
        for (const row of groupRows) {
          results.push({ email: row.email, success: false, error: `A project named "${projectName}" already has admins — choose a different name or manage it from the existing project.` });
        }
        continue;
      } else {
        for (const row of groupRows) {
          results.push({ email: row.email, success: false, error: `Project "${projectName}" could not be created: ${projectError?.message ?? "unknown error"}` });
        }
        continue;
      }
    }

    for (const row of groupRows) {
      if (!isFirstRow) await new Promise((resolve) => setTimeout(resolve, BULK_INVITE_DELAY_MS));
      isFirstRow = false;

      const result = await inviteAndSetupUser(admin, caller, { name: row.name, email: row.email, phone: row.phone, role: "project_admin" }, projectId);
      if (result.error) {
        results.push({ email: row.email, success: false, error: result.error });
      } else {
        results.push({ email: row.email, success: true });
        anySuccess = true;
      }
    }
  }

  if (anySuccess) revalidatePath("/project-admins");
  return { results };
}
