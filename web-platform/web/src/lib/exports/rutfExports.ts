import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { monthOf } from "@/lib/queries/kpis";

// RUTF exports for the Reporting Centre (brief §9–§10). One month at a time, CSV, built with the
// caller's own client — RLS scopes every row, exactly as on screen. Admins and reviewers download
// directly; a Viewer's request goes through Download Requests and is built here on approval.
//
// Privacy: no person-level data about children or caregivers exists to export. Child counts per
// OTP-month (children seen, new admissions) below 5 are written as "<5" (brief §10 small cells).
// The ledger export carries no names of the staff who recorded entries.

type Client = SupabaseClient<Database>;
export type RutfExportKind = "kpis" | "facility_metrics" | "ledger" | "transfers";

export const RUTF_EXPORTS: Record<RutfExportKind, { title: string; description: string; resource: string }> = {
  kpis: { title: "Monthly KPIs", description: "Stock on hand, months of stock, stockout, variance, dispensing and supervision KPIs for the month.", resource: "rutf_kpis" },
  facility_metrics: { title: "Facility metrics", description: "One row per store and OTP site: balance, months of stock, variance, short-dispensing, VF, reporting, Findings.", resource: "rutf_facility_metrics" },
  ledger: { title: "Stock ledger", description: "Every ledger entry in the month, with lot, quantity, document number and status (voided entries marked).", resource: "rutf_ledger" },
  transfers: { title: "Transfers", description: "Transfers issued in the month: from, to, sachets issued and received, status, days in transit.", resource: "rutf_transfers" },
};

export const resourceToKind = (resource: string): RutfExportKind | null =>
  (Object.entries(RUTF_EXPORTS).find(([, v]) => v.resource === resource)?.[0] as RutfExportKind | undefined) ?? null;

const LEVEL: Record<string, string> = { state_store: "State store", lga_store: "LGA store", health_facility: "OTP site" };

function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // A text cell starting with = + - @ would run as a formula in a spreadsheet (CSV injection).
  if (typeof value === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (header: string[], rows: unknown[][]) => [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
const small = (n: number | null | undefined) => (n === null || n === undefined ? null : n > 0 && n < 5 ? "<5" : n);

async function pages<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetch(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function names(supabase: Client) {
  const [facilities, lgas, lots] = await Promise.all([
    pages((a, b) => supabase.from("facilities").select("id, name, facility_type, lga_id").order("id").range(a, b)),
    supabase.from("lgas").select("id, name"),
    pages((a, b) => supabase.from("product_lots").select("id, lot_no, expiry_date").order("id").range(a, b)),
  ]);
  return {
    facility: new Map(facilities.map((f) => [f.id, f])),
    lga: new Map((lgas.data ?? []).map((l) => [l.id, l.name])),
    lot: new Map(lots.map((l) => [l.id, l])),
  };
}

export async function buildRutfExport(supabase: Client, kind: RutfExportKind, monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("Month must be YYYY-MM");
  const month = monthOf(monthKey);
  const filename = `rutf-${kind.replace("_", "-")}-${month.key}.csv`;

  if (kind === "kpis") {
    const { data, error } = await supabase.rpc("rutf_kpis", { p_start: month.start, p_end: month.end });
    if (error) throw new Error(error.message);
    const rows: unknown[][] = [];
    const walk = (prefix: string, v: unknown) => {
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x);
      else rows.push([prefix, Array.isArray(v) ? v.join(" to ") : v]);
    };
    walk("", data);
    return { filename, content: csv(["indicator", "value"], [["month", month.key], ...rows]) };
  }

  const n = await names(supabase);
  const fac = (id: string | null) => (id ? n.facility.get(id) : undefined);

  if (kind === "facility_metrics") {
    const { data, error } = await supabase.rpc("facility_metrics", { p_start: month.start, p_end: month.end });
    if (error) throw new Error(error.message);
    const header = ["facility", "level", "lga", "balance", "monthly_outflow", "months_of_stock", "expired_balance", "stockout_days",
      "last_count_date", "last_variance_pct", "sachets_prescribed", "sachets_dispensed", "short_pct", "children_seen", "new_admissions",
      "dispensing_weeks", "expected_weeks", "count_on_time", "last_visit_date", "last_vf", "open_findings", "open_critical"];
    const rows = (data ?? []).map((r) => [r.facility_name, LEVEL[r.facility_type], n.lga.get(r.lga_id), r.balance, r.monthly_outflow,
      r.months_of_stock, r.expired_balance, r.stockout_days, r.last_count_date, r.last_variance_pct, r.sachets_prescribed,
      r.sachets_dispensed, r.short_pct, small(r.children_seen), small(r.new_admissions), r.dispensing_weeks, r.expected_weeks,
      r.count_on_time ? "yes" : "no", r.last_visit_date, r.last_vf, r.open_findings, r.open_critical]);
    return { filename, content: csv(header, rows) };
  }

  if (kind === "ledger") {
    const txns = await pages((a, b) =>
      supabase.from("stock_transactions")
        .select("txn_date, facility_id, txn_type, lot_id, lot_no_seen, quantity_sachets, counterparty_facility_id, document_no, reason, status, void_reason, submission_local_id")
        .gte("txn_date", month.start).lte("txn_date", month.end)
        .order("txn_date").order("facility_id").order("local_id").range(a, b));
    const header = ["date", "facility", "level", "lga", "type", "lot", "expiry", "sachets", "counterparty", "document_no", "reason", "status", "void_reason", "entry_id"];
    const rows = txns.map((t) => {
      const f = fac(t.facility_id);
      const lot = t.lot_id ? n.lot.get(t.lot_id) : undefined;
      return [t.txn_date, f?.name, f ? LEVEL[f.facility_type] : null, f ? n.lga.get(f.lga_id) : null, t.txn_type,
        lot?.lot_no ?? t.lot_no_seen, lot?.expiry_date, t.quantity_sachets, fac(t.counterparty_facility_id)?.name,
        t.document_no, t.reason, t.status, t.void_reason, t.submission_local_id];
    });
    return { filename, content: csv(header, rows) };
  }

  const transfers = await pages((a, b) =>
    supabase.from("transfer_overview")
      .select("code, issued_date, received_date, from_facility_id, to_facility_id, sachets_issued, sachets_received, gap, status, days_in_transit, document_no")
      .gte("issued_date", month.start).lte("issued_date", month.end)
      .order("issued_date").order("code").range(a, b));
  const header = ["transfer", "issued", "received", "from", "to", "to_lga", "sachets_issued", "sachets_received", "gap", "status", "days_in_transit", "document_no"];
  const rows = transfers.map((t) => [t.code, t.issued_date, t.received_date, fac(t.from_facility_id)?.name, fac(t.to_facility_id)?.name,
    (() => { const f = fac(t.to_facility_id); return f ? n.lga.get(f.lga_id) : null; })(), t.sachets_issued, t.sachets_received,
    t.status === "in_transit" || t.status === "cancelled" ? null : t.gap, t.status, t.days_in_transit, t.document_no]);
  return { filename, content: csv(header, rows) };
}
