import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { AppShell } from "@/components/app-shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, officerLevel] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);

  return <AppShell profile={profile} officerLevel={officerLevel}>{children}</AppShell>;
}
