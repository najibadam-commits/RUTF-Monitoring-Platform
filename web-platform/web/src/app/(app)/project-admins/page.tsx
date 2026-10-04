import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessProjectAdminPanel } from "@/lib/rbac";
import { OPEN_STATUSES } from "@/lib/constants";
import { ProjectAdminsTable, type Programme } from "@/components/users/ProjectAdminsTable";

export const metadata: Metadata = { title: "Programme Administrators" };

// Programme Administrators (DECISIONS R96): each programme on the platform (the Katsina RUTF Pilot
// today) with its administrators and footprint — LGAs, stores and OTP sites, users, open Findings —
// the steps to bring another state on, and the Project Admin accounts. Super Admin only.

export default async function ProjectAdminsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessProjectAdminPanel(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("*, project:projects(name)").eq("role", "project_admin").order("name"),
    supabase.from("projects").select("id, name, created_at").order("created_at"),
  ]);
  const admins = (data ?? []) as unknown as Parameters<typeof ProjectAdminsTable>[0]["admins"];

  const programmes: Programme[] = await Promise.all(
    (projects ?? []).map(async (p) => {
      const [{ data: sites }, users, open] = await Promise.all([
        supabase.from("facilities").select("lga_id").eq("project_id", p.id).eq("status", "approved").eq("is_active", true)
          .or("facility_type.neq.health_facility,is_otp_site.eq.true"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("project_id", p.id).eq("status", "active"),
        supabase.from("issues").select("id", { count: "exact", head: true }).eq("project_id", p.id).in("status", OPEN_STATUSES),
      ]);
      return {
        id: p.id,
        name: p.name,
        createdAt: p.created_at,
        admins: admins.filter((a) => a.project_id === p.id).map((a) => a.name),
        lgas: new Set((sites ?? []).map((s) => s.lga_id)).size,
        sites: (sites ?? []).length,
        users: users.count ?? 0,
        openFindings: open.count ?? 0,
      };
    }),
  );

  return <ProjectAdminsTable admins={admins} programmes={programmes} />;
}
