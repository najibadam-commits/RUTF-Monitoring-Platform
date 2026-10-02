import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessAttendance } from "@/lib/rbac";
import { getAttendanceRecords } from "@/lib/queries/attendance";
import { AttendanceTable } from "@/components/attendance/AttendanceTable";

export default async function AttendancePage() {
  const profile = await getCurrentProfile();
  if (!canAccessAttendance(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const records = await getAttendanceRecords(supabase);

  // Signed URLs, same pattern as the Finding Detail page's evidence photos — the bucket is
  // private (never public), so every view needs a fresh short-lived link.
  const withPhotos = await Promise.all(
    records.map(async (r) => {
      const [selfie, locationPhoto] = await Promise.all([
        supabase.storage.from("attendance-evidence").createSignedUrl(r.selfie_storage_path, 3600),
        supabase.storage.from("attendance-evidence").createSignedUrl(r.assignment_location_storage_path, 3600),
      ]);
      return { ...r, selfieUrl: selfie.data?.signedUrl ?? null, locationPhotoUrl: locationPhoto.data?.signedUrl ?? null };
    }),
  );

  return <AttendanceTable records={withPhotos} />;
}
