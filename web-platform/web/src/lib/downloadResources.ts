// Readable names for download_requests.resource_type (client-safe; the export builders are
// server-only in lib/exports).
export const RESOURCE_LABEL: Record<string, string> = {
  issues_export: "Findings",
  rutf_kpis: "Monthly KPIs",
  rutf_facility_metrics: "Facility metrics",
  rutf_ledger: "Stock ledger",
  rutf_transfers: "Transfers",
};

export function filtersSummary(filters: unknown): string {
  if (!filters || typeof filters !== "object") return "—";
  const entries = Object.entries(filters as Record<string, unknown>).filter(([, v]) => v);
  if (entries.length === 0) return "All (no filters)";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}
