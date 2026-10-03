import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessSettings } from "@/lib/rbac";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessSettings(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();

  if (!settings) redirect("/dashboard");

  return <SettingsClient settings={settings} />;
}
