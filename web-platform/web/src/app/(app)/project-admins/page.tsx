import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessProjectAdminPanel } from "@/lib/rbac";
import { ProjectAdminsTable } from "@/components/users/ProjectAdminsTable";

export const metadata: Metadata = { title: "Programme Administrators" };

export default async function ProjectAdminsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessProjectAdminPanel(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*, project:projects(name)").eq("role", "project_admin").order("name");

  return <ProjectAdminsTable admins={(data ?? []) as unknown as Parameters<typeof ProjectAdminsTable>[0]["admins"]} />;
}
