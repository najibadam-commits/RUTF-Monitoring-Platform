import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessSettings } from "@/lib/rbac";
import { getStates } from "@/lib/queries/lookups";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessSettings(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: settings }, states] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).single(),
    getStates(supabase),
  ]);

  if (!settings) redirect("/dashboard");

  return <SettingsClient settings={settings} states={states} />;
}
