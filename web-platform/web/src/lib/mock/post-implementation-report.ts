// MOCK DATA — Post Implementation Report has no backend yet; replace with a real Supabase
// query (and a real PDF/Excel export pipeline) when this feature ships. See DECISIONS.md #12.
// All figures and report entries below are invented for preview purposes only.

export type ReportStatus = "draft" | "final";

export interface ProjectReport {
  id: string;
  name: string;
  project: string;
  generatedAt: string;
  status: ReportStatus;
}

export const RECENT_REPORTS: ProjectReport[] = [
  { id: "r1", name: "Q3 2026 Implementation Summary — Lagos", project: "Northern Corridor Program", generatedAt: "2026-09-01", status: "final" },
  { id: "r2", name: "Post-Implementation Review — Kano WASH", project: "Northern Corridor Program", generatedAt: "2026-08-24", status: "final" },
  { id: "r3", name: "Rivers State Outcome Report (Draft)", project: "Southern Delta Initiative", generatedAt: "2026-08-18", status: "draft" },
  { id: "r4", name: "Kaduna Infrastructure Closeout", project: "Northern Corridor Program", generatedAt: "2026-08-10", status: "final" },
  { id: "r5", name: "Q2 2026 Portfolio Summary", project: "All Projects", generatedAt: "2026-07-02", status: "final" },
];

export const PROJECTS_COMPLETED_MOCK = 18;
export const AVG_COMPLETION_DAYS_MOCK = 46;
export const SUCCESS_RATE_PCT_MOCK = 89;
