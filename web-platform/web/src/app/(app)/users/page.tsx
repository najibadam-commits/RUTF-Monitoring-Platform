import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessUsersScreen } from "@/lib/rbac";
import { getLgas, getStates } from "@/lib/queries/lookups";
import { UsersTable } from "@/components/users/UsersTable";
import type { FacilityOption } from "@/components/users/FacilityPicker";

export default async function UsersPage() {
  const profile = await getCurrentProfile();
  if (!canAccessUsersScreen(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, states, lgas, { data: facilities }] = await Promise.all([
    supabase.from("profiles").select("*").order("name"),
    getStates(supabase),
    getLgas(supabase),
    // Facility users are assigned to stores and OTP sites only (RUTF DECISIONS R15).
    supabase
      .from("facilities")
      .select("id, name, facility_type, lga_id, national_code")
      .eq("status", "approved")
      .eq("is_active", true)
      .or("facility_type.neq.health_facility,is_otp_site.eq.true")
      .order("name"),
  ]);

  const users = data ?? [];
  const { data: supervisorLgas } = await supabase.from("supervisor_lgas").select("profile_id, lga_id");
  const supervisedLgas: Record<string, string[]> = {};
  for (const r of supervisorLgas ?? []) (supervisedLgas[r.profile_id] ??= []).push(r.lga_id);
  const facilityNames: Record<string, string> = Object.fromEntries((facilities ?? []).map((f) => [f.id, f.name]));
  // A user may still point at a facility that is no longer assignable (deactivated, OTP flag off).
  const missing = [...new Set(users.map((u) => u.facility_id).filter((id): id is string => !!id && !facilityNames[id]))];
  if (missing.length) {
    const { data: extra } = await supabase.from("facilities").select("id, name").in("id", missing);
    for (const f of extra ?? []) facilityNames[f.id] = f.name;
  }

  return (
    <UsersTable
      users={users}
      callerRole={profile.role}
      callerId={profile.id}
      states={states}
      facilities={(facilities ?? []) as FacilityOption[]}
      facilityNames={facilityNames}
      lgas={lgas.map((l) => ({ id: l.id, name: l.name }))}
      supervisedLgas={supervisedLgas}
    />
  );
}
