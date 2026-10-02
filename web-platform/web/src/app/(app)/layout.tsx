import { getCurrentProfile } from "@/lib/supabase/dal";
import { AppShell } from "@/components/app-shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return <AppShell profile={profile}>{children}</AppShell>;
}
