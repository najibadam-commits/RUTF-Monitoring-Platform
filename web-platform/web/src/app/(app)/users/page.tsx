import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessUsersScreen } from "@/lib/rbac";
import { getCategories, getStates } from "@/lib/queries/lookups";
import { UsersTable } from "@/components/users/UsersTable";

export default async function UsersPage() {
  const profile = await getCurrentProfile();
  if (!canAccessUsersScreen(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, states, sectors] = await Promise.all([
    supabase.from("profiles").select("*").order("name"),
    getStates(supabase),
    getCategories(supabase),
  ]);

  return <UsersTable users={data ?? []} callerRole={profile.role} callerId={profile.id} states={states} sectors={sectors} />;
}
