import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessSettings } from "@/lib/rbac";
import { SettingsClient, type ReadinessItem } from "@/components/settings/SettingsClient";

export const metadata: Metadata = { title: "Settings" };

// Settings (DECISIONS R97): the notification sender and data notes, plus a go-live readiness
// checklist — checked live where the platform can tell (sender, demo data, real accounts, phones on
// the current app), and marked as programme decisions where it can't (thresholds, DPIA, UAT, signing).

/** The Android build pilot phones should run (android/app/build.gradle.kts versionName). */
const CURRENT_APP = "1.1";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessSettings(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: settings }, dummyFacilities, dummyUsers, allUsers, { data: devices }] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).single(),
    supabase.from("facilities").select("id", { count: "exact", head: true }).not("dummy_fields", "is", null),
    supabase.from("profiles").select("id", { count: "exact", head: true }).ilike("name", "%(DUMMY)%"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.rpc("sync_health"),
  ]);

  if (!settings) redirect("/dashboard");

  const dummyF = dummyFacilities.count ?? 0;
  const dummyU = dummyUsers.count ?? 0;
  const realUsers = Math.max(0, (allUsers.count ?? 0) - dummyU);
  const phones = (devices ?? []).filter((d) => d.device_id); // accounts with a phone that has reported
  const current = phones.filter((d) => d.app_version === CURRENT_APP).length;

  const readiness: ReadinessItem[] = [
    {
      title: "Emails sent from the programme's own domain",
      state: settings.email_from_address ? "done" : "todo",
      detail: settings.email_from_address ? `Sending as ${settings.email_from_address}` : "Using Resend's test sender: verify the domain in Resend, then set it below",
    },
    {
      title: "Demo data cleared before real data",
      state: dummyF || dummyU ? "todo" : "done",
      detail: dummyF || dummyU ? `${dummyF.toLocaleString("en-GB")} DUMMY facilities and ${dummyU.toLocaleString("en-GB")} DUMMY accounts still loaded (DECISIONS R32)` : "No DUMMY records",
    },
    {
      title: "Pilot teams invited",
      state: realUsers > 10 ? "done" : "todo",
      detail: `${realUsers.toLocaleString("en-GB")} real active account${realUsers === 1 ? "" : "s"}; supervisors and facility users are added in Users & Access`,
      href: "/users",
    },
    {
      title: `Phones on app ${CURRENT_APP}`,
      state: phones.length && current === phones.length ? "done" : "todo",
      detail: phones.length ? `${current} of ${phones.length} reporting phones on ${CURRENT_APP}` : "No phone has reported yet; install the M6 build on pilot phones",
      href: "/devices",
    },
    { title: "Thresholds agreed with the State team", state: "decision", detail: "Variance, short-dispensing, register check and Finding target limits", href: "/data-sets?tab=thresholds" },
    { title: "Data protection sign-off", state: "decision", detail: "DPIA draft for the Data Protection Officer; retention periods to set (NDPA 2023)" },
    { title: "User acceptance testing", state: "decision", detail: "UAT script ready for the State team to run and sign" },
    { title: "Release signing key for the Android app", state: "decision", detail: "Created and held by the programme, for the production build" },
  ];

  return <SettingsClient settings={settings} readiness={readiness} />;
}
