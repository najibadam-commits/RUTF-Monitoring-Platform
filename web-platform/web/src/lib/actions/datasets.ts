"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canManageDatasets } from "@/lib/rbac";

type ActionResult = { error?: string };

function afterChange() {
  revalidatePath("/data-sets");
}

// ── Settlements ───────────────────────────────────────────────────────────
// statename/lganame are derived server-side from ward_id (migration 0019's
// derive_dataset_location_names trigger) — the client only ever supplies
// ward_id + the name, never state/LGA text directly.

export async function addSettlementAction(input: { wardId: string; settlementname: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };
  if (!input.wardId || !input.settlementname.trim()) return { error: "Ward and settlement name are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("settlements").insert({ ward_id: input.wardId, settlementname: input.settlementname });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

type BulkResult = { error?: string; inserted?: number };

const BULK_CHUNK_SIZE = 500;
// No external rate limit applies to a plain table insert (unlike Bulk Import Users' Auth API
// calls) — this is just a sane upper bound, not a workaround for a real constraint.
const BULK_DATASET_IMPORT_MAX_ROWS = 1000;

export async function bulkAddSettlementsAction(rows: { wardId: string; settlementname: string }[]): Promise<BulkResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to upload." };
  if (rows.length > BULK_DATASET_IMPORT_MAX_ROWS) return { error: `Up to ${BULK_DATASET_IMPORT_MAX_ROWS} rows at a time.` };

  const supabase = await createClient();
  for (let i = 0; i < rows.length; i += BULK_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BULK_CHUNK_SIZE).map((r) => ({ ward_id: r.wardId, settlementname: r.settlementname }));
    const { error } = await supabase.from("settlements").insert(chunk);
    if (error) return { error: `Failed at row ${i + 1}: ${error.message}` };
  }
  afterChange();
  return { inserted: rows.length };
}

export async function updateSettlementAction(id: string, input: { wardId: string; settlementname: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.from("settlements").update({ ward_id: input.wardId, settlementname: input.settlementname }).eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function deleteSettlementAction(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.from("settlements").delete().eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function approveSettlementAction(id: string, note: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (profile.role !== "super_admin") return { error: "Only Super Admin may approve." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_settlement", { p_id: id, p_note: note || null });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function rejectSettlementAction(id: string, note: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (profile.role !== "super_admin") return { error: "Only Super Admin may reject." };
  if (!note.trim()) return { error: "A note explaining the rejection is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_settlement", { p_id: id, p_note: note });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

// ── Activity Sites ────────────────────────────────────────────────────────
// Independent of Settlements — both are siblings tied directly to a Ward,
// not a Settlement -> Activity Site chain (see DECISIONS.md #8).

export async function addActivitySiteAction(input: { wardId: string; activitysitename: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };
  if (!input.wardId || !input.activitysitename.trim()) return { error: "Ward and activity site name are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("activity_sites").insert({ ward_id: input.wardId, activitysitename: input.activitysitename });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function bulkAddActivitySitesAction(rows: { wardId: string; activitysitename: string }[]): Promise<BulkResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to upload." };
  if (rows.length > BULK_DATASET_IMPORT_MAX_ROWS) return { error: `Up to ${BULK_DATASET_IMPORT_MAX_ROWS} rows at a time.` };

  const supabase = await createClient();
  for (let i = 0; i < rows.length; i += BULK_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BULK_CHUNK_SIZE).map((r) => ({ ward_id: r.wardId, activitysitename: r.activitysitename }));
    const { error } = await supabase.from("activity_sites").insert(chunk);
    if (error) return { error: `Failed at row ${i + 1}: ${error.message}` };
  }
  afterChange();
  return { inserted: rows.length };
}

export async function updateActivitySiteAction(id: string, input: { wardId: string; activitysitename: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("activity_sites")
    .update({ ward_id: input.wardId, activitysitename: input.activitysitename })
    .eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function deleteActivitySiteAction(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.from("activity_sites").delete().eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function approveActivitySiteAction(id: string, note: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (profile.role !== "super_admin") return { error: "Only Super Admin may approve." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_activity_site", { p_id: id, p_note: note || null });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function rejectActivitySiteAction(id: string, note: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (profile.role !== "super_admin") return { error: "Only Super Admin may reject." };
  if (!note.trim()) return { error: "A note explaining the rejection is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_activity_site", { p_id: id, p_note: note });
  if (error) return { error: error.message };
  afterChange();
  return {};
}
