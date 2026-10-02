// MOCK DATA — Teams has no backend yet; replace with a real Supabase query when this feature
// ships (see DECISIONS.md #12). This Supabase project's `projects` table is currently empty
// and every profile is unscoped (project_id null), so this page stays fully self-contained
// mock rather than querying real (but empty) data — every field below is invented for preview
// purposes only. Project names reuse the same fictional projects introduced in the Post
// Implementation Report mock data, for internal consistency across the mock pages.
//
// `avgResponseHours`/`resolutionRate`/`deviceUtilization` (added for the Team Performance
// Report page, see DECISIONS.md #15) are invented plausible figures too — NOT derived from
// `devices.ts`, whose 6 rows are an illustrative subset, not a real per-team device pool.

export type TeamStatus = "active" | "inactive";

export interface Team {
  name: string;
  project: string;
  lead: string;
  memberCount: number;
  devicesAssigned: number;
  status: TeamStatus;
  /** Avg time from issue assignment to first DRI response, in hours. */
  avgResponseHours: number;
  /** % of the team's assigned issues resolved or verified/closed. */
  resolutionRate: number;
  /** % of the team's assigned devices actively syncing (not needs-sync/inactive). */
  deviceUtilization: number;
}

export const TEAMS: Team[] = [
  { name: "Lagos Field Team", project: "Northern Corridor Program", lead: "Amina Yusuf", memberCount: 8, devicesAssigned: 8, status: "active", avgResponseHours: 3.5, resolutionRate: 88, deviceUtilization: 92 },
  { name: "Kano WASH Team", project: "Northern Corridor Program", lead: "Ibrahim Suleiman", memberCount: 6, devicesAssigned: 5, status: "active", avgResponseHours: 5.2, resolutionRate: 81, deviceUtilization: 85 },
  { name: "Rivers Delta Team", project: "Southern Delta Initiative", lead: "Grace Effiong", memberCount: 5, devicesAssigned: 5, status: "active", avgResponseHours: 4.1, resolutionRate: 90, deviceUtilization: 88 },
  { name: "Kaduna Infrastructure Team", project: "Northern Corridor Program", lead: "Suleiman Abdullahi", memberCount: 4, devicesAssigned: 3, status: "active", avgResponseHours: 6.8, resolutionRate: 74, deviceUtilization: 70 },
  { name: "Borno Response Team", project: "Northern Corridor Program", lead: "Blessing Adeyemi", memberCount: 3, devicesAssigned: 2, status: "inactive", avgResponseHours: 9.4, resolutionRate: 62, deviceUtilization: 45 },
];
