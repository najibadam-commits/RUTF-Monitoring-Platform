import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ISSUE_SELECT, type IssueWithRelations } from "@/lib/queries/issues";
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/constants";
import type { Database, IssuePriority, IssueStatus } from "@/lib/types/database";

// Shared by the instant download (app/(app)/issues/export/route.ts, every non-Viewer role) and the
// Viewer download-request fulfilment step (lib/actions/downloadRequests.ts) — both must build the
// exact same query and render the exact same file for a given filter set.

export interface IssuesExportFilters {
  status?: string;
  priority?: string;
  category?: string;
  state?: string;
  search?: string;
}

export function buildIssuesExportQuery(supabase: SupabaseClient<Database>, filters: IssuesExportFilters) {
  let query = supabase.from("issues").select(ISSUE_SELECT).order("reported_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status as IssueStatus);
  if (filters.priority) query = query.eq("priority", filters.priority as IssuePriority);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.state) query = query.eq("state_id", filters.state);
  if (filters.search) query = query.or(`description.ilike.%${filters.search}%,code.ilike.%${filters.search}%`);
  return query;
}

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = ["Issue ID", "Sector", "State", "LGA", "Ward", "Priority", "Status", "Reported By", "Assigned DRI", "Reported At", "Resolution Date", "Description"];

function toCsv(rows: IssueWithRelations[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const i of rows) {
    lines.push(
      [
        i.code,
        i.category?.name,
        i.state?.name,
        i.lga?.name,
        i.ward,
        PRIORITY_LABEL[i.priority as IssuePriority],
        STATUS_LABEL[i.status as IssueStatus],
        i.reporter?.name,
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
    category: i.category?.name ?? null,
    state: i.state?.name ?? null,
    lga: i.lga?.name ?? null,
    ward: i.ward ?? null,
    priority: PRIORITY_LABEL[i.priority as IssuePriority],
    status: STATUS_LABEL[i.status as IssueStatus],
    reportedBy: i.reporter?.name ?? null,
    assignedDri: i.dri?.name ?? "Unassigned",
    reportedAt: i.reported_at,
    resolutionDate: i.resolution_date ?? null,
    description: i.description,
  }));
  return JSON.stringify(payload, null, 2);
}

export function renderIssuesExport(rows: IssueWithRelations[], format: string) {
  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return { content: toJson(rows), contentType: "application/json; charset=utf-8", filename: `issues-export-${date}.json` };
  }
  return { content: toCsv(rows), contentType: "text/csv; charset=utf-8", filename: `issues-export-${date}.csv` };
}
