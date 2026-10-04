// Readable names for download_requests.resource_type (client-safe; the export builders are
// server-only in lib/exports).
export const RESOURCE_LABEL: Record<string, string> = {
  issues_export: "Findings",
  rutf_kpis: "Monthly KPIs",
  rutf_facility_metrics: "Facility metrics",
  rutf_ledger: "Stock ledger",
  rutf_transfers: "Transfers",
};

/** Names for the ids a request's filters can hold — looked up on the server and passed in. */
export type ScopeNames = Record<string, string>;

const VALUE_LABEL: Record<string, Record<string, string>> = {
  status: {
    new: "New", pending_review: "Awaiting review", returned_for_correction: "Returned to reporter", assigned: "Assigned to facility",
    in_progress: "Being addressed", resolved: "Action recorded", verified_closed: "Verified & closed", reopened: "Reopened",
  },
  priority: { critical: "Critical", high: "High", medium: "Medium", low: "Low" },
  source: { auto: "Automatic checks", manual: "Registered by a person" },
  view: { open: "Open Findings", critical: "Critical and open", overdue: "Open past the target" },
};
const KEY_LABEL: Record<string, string> = {
  status: "Status", priority: "Priority", category: "Facility level", state: "State", lga: "LGA", search: "Search",
  source: "Source", type: "Finding type", view: "View", visit: "Supervision visit",
};

/** A request's scope in words (DECISIONS R93), e.g. "September 2026" or "Katsina · Critical and open". */
export function describeScope(filters: unknown, names: ScopeNames = {}): string {
  if (!filters || typeof filters !== "object") return "Everything you can see";
  const f = Object.fromEntries(Object.entries(filters as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const parts: string[] = [];
  if (typeof f.month === "string" && /^\d{4}-\d{2}$/.test(f.month)) {
    parts.push(new Date(`${f.month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }));
  }
  for (const [k, raw] of Object.entries(f)) {
    if (k === "month" || k === "format") continue;
    const v = String(raw);
    const label = VALUE_LABEL[k]?.[v] ?? names[v] ?? (k === "search" ? `“${v}”` : /^[0-9a-f-]{36}$/.test(v) ? "selected" : v);
    parts.push(k === "view" || k === "source" ? label : `${KEY_LABEL[k] ?? k}: ${label}`);
  }
  return parts.length ? parts.join(" · ") : "Everything you can see";
}
