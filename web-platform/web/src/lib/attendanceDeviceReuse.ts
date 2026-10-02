import type { AttendanceRow } from "@/lib/queries/attendance";

/**
 * Item 12's "device reuse" monitoring signal: device_ids that appear under more than one Field
 * Monitor account — surfaced to admins as a flag, never used to block a submission (the app
 * only ever *prevents* a duplicate same-day, same-Field-Monitor record; a device shared across
 * people is suspicious, not necessarily invalid — e.g. a handed-down phone).
 *
 * Deliberately its own module, separate from `queries/attendance.ts` — this is a pure function
 * with no Supabase dependency, but `AttendanceTable.tsx` (a Client Component) needs to call it
 * directly. `queries/attendance.ts` starts with `import "server-only"`, and Next.js treats any
 * runtime import from that file — even of an unrelated export — as pulling the whole
 * "server-only" module into the client bundle, which fails the build outright. Only a
 * type-only import of `AttendanceRow` crosses that boundary here, which TypeScript fully erases
 * at compile time.
 */
export function findReusedDeviceIds(records: AttendanceRow[]): Set<string> {
  const byDevice = new Map<string, Set<string>>();
  for (const r of records) {
    if (!byDevice.has(r.device_id)) byDevice.set(r.device_id, new Set());
    byDevice.get(r.device_id)!.add(r.field_monitor_id);
  }
  const reused = new Set<string>();
  for (const [deviceId, monitors] of byDevice) {
    if (monitors.size > 1) reused.add(deviceId);
  }
  return reused;
}
