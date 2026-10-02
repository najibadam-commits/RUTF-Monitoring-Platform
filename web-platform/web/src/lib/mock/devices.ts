// MOCK DATA — Devices/IMEI tracking has no backend yet; replace with a real Supabase query
// when this feature ships (see DECISIONS.md #12). Nothing in this app (web, Supabase, or the
// Android field app) captures a device identifier today — this is entirely illustrative.
// "Assigned To" reuses the same fictional team leads introduced in teams.ts, not any real
// profile in this project, to keep this page fully self-contained.

export type DeviceStatus = "active" | "inactive" | "needs_sync";

export interface Device {
  imei: string;
  assignedTo: string;
  model: string;
  lastSyncAt: string;
  status: DeviceStatus;
}

export const DEVICES: Device[] = [
  { imei: "356938035643809", assignedTo: "Amina Yusuf", model: "Samsung Galaxy A14", lastSyncAt: "2026-09-09T14:20:00Z", status: "active" },
  { imei: "356938035643810", assignedTo: "Ibrahim Suleiman", model: "Samsung Galaxy A14", lastSyncAt: "2026-09-08T09:05:00Z", status: "active" },
  { imei: "356938035643811", assignedTo: "Grace Effiong", model: "Tecno Spark 10", lastSyncAt: "2026-09-01T11:40:00Z", status: "needs_sync" },
  { imei: "356938035643812", assignedTo: "Suleiman Abdullahi", model: "Samsung Galaxy A14", lastSyncAt: "2026-09-07T16:55:00Z", status: "active" },
  { imei: "356938035643813", assignedTo: "Blessing Adeyemi", model: "Tecno Spark 10", lastSyncAt: "2026-08-20T08:15:00Z", status: "needs_sync" },
  { imei: "356938035643814", assignedTo: "Unassigned", model: "Samsung Galaxy A14", lastSyncAt: "2026-07-30T10:00:00Z", status: "inactive" },
];
