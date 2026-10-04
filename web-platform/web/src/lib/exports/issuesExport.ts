import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ISSUE_SELECT, applyIssueFilters, type IssueFilters, type IssueWithRelations } from "@/lib/queries/issues";
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/constants";
import type { Database, IssuePriority, IssueStatus } from "@/lib/types/database";

// Shared by the instant download (app/(app)/issues/export/route.ts, every non-Viewer role) and the
// Viewer download-request fulfilment step (lib/actions/downloadRequests.ts) — both must build the
// exact same query and render the exact same file for a given filter set.

export type IssuesExportFilters = IssueFilters;

/** The export query — the Findings Register's own filters (applyIssueFilters), so a download
 *  matches the list on screen, including the source, Finding type and summary-card views. */
export function buildIssuesExportQuery(supabase: SupabaseClient<Database>, filters: IssuesExportFilters, targetDays = 30, now = Date.now()) {
  return applyIssueFilters(supabase.from("issues").select(ISSUE_SELECT).order("reported_at", { ascending: false }), filters, targetDays, now);
}

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = ["Finding ID", "Finding type", "Source", "Facility", "Facility level", "State", "LGA", "Ward", "Priority", "Status", "Raised by", "Assigned to", "Reported at", "Resolution date", "Description"];

function toCsv(rows: IssueWithRelations[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const i of rows) {
    lines.push(
      [
        i.code,
        i.finding?.label ?? "",
        i.auto_generated ? "Automatic check" : "Registered by a person",
        i.facility?.name ?? "",
        i.category?.name,
        i.state?.name,
        i.lga?.name,
        i.ward_ref?.name ?? i.ward,
        PRIORITY_LABEL[i.priority as IssuePriority],
        STATUS_LABEL[i.status as IssueStatus],
        i.auto_generated ? "Automatic checks" : i.reporter?.name,
        i.dri?.name ?? "Unassigned",
        i.reported_at,
        i.resolution_date ?? "",
        i.description,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function toJson(rows: IssueWithRelations[]): string {
  const payload = rows.map((i) => ({
    id: i.code,
    findingType: i.finding?.label ?? null,
    source: i.auto_generated ? "automatic" : "person",
    facility: i.facility?.name ?? null,
    facilityLevel: i.category?.name ?? null,
    state: i.state?.name ?? null,
    lga: i.lga?.name ?? null,
    ward: i.ward_ref?.name ?? i.ward ?? null,
    priority: PRIORITY_LABEL[i.priority as IssuePriority],
    status: STATUS_LABEL[i.status as IssueStatus],
    reportedBy: i.auto_generated ? "Automatic checks" : i.reporter?.name ?? null,
    assignedTo: i.dri?.name ?? "Unassigned",
    reportedAt: i.reported_at,
    resolutionDate: i.resolution_date ?? null,
    description: i.description,
  }));
  return JSON.stringify(payload, null, 2);
}

export function renderIssuesExport(rows: IssueWithRelations[], format: string) {
  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return { content: toJson(rows), contentType: "application/json; charset=utf-8", filename: `findings-register-${date}.json` };
  }
  return { content: toCsv(rows), contentType: "text/csv; charset=utf-8", filename: `findings-register-${date}.csv` };
}
