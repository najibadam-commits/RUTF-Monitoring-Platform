import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const ATTENDANCE_SELECT = `
  id, field_monitor_id, project_id, attendance_date, captured_at, lat, lng, gps_accuracy_m,
  state_id, lga_id, selfie_storage_path, assignment_location_storage_path, device_id, status, created_at,
  field_monitor:profiles!field_monitor_attendance_field_monitor_id_fkey(id, name, email),
  state:states(name), lga:lgas(name)
`;

export type AttendanceRow = Database["public"]["Tables"]["field_monitor_attendance"]["Row"] & {
  field_monitor: { id: string; name: string; email: string } | null;
  state: { name: string } | null;
  lga: { name: string } | null;
};

/** RLS (migration 0037) already scopes this correctly per caller role — every record for Super
 *  Admin, the caller's own project for Project Admin, the caller's own managed state for State
 *  Coordinator — no manual filter needed here. */
export async function getAttendanceRecords(client: SupabaseClient<Database>) {
  const { data } = await client
    .from("field_monitor_attendance")
    .select(ATTENDANCE_SELECT)
    .order("attendance_date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as AttendanceRow[];
}
