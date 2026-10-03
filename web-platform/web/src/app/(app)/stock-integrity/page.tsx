import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth } from "@/lib/queries/metrics";
import { FacilityLink, Flag, LEVEL_LABEL, ReportShell, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";

// Stock Integrity (brief §9): variance by facility (last count against the ledger), months of
// stock, stockout days, expired stock — plus the expiry watchlist. From facility_metrics()
// (migration 0105). Worst first.

const EXPIRY_WARN_DAYS = 90;

export default async function StockIntegrityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [rows, lgas, { data: lots }, { data: thresholds }] = await Promise.all([
    getFacilityMetrics(supabase, month, { level: sp.level, lga: sp.lga }),
    getLgas(supabase),
    supabase.from("stock_balances").select("facility_id, lot_id, lot_no, expiry_date, balance").gt("balance", 0).not("expiry_date", "is", null)
      .lte("expiry_date", new Date(Date.parse(month.end) + EXPIRY_WARN_DAYS * 86_400_000).toISOString().slice(0, 10))
      .order("expiry_date").limit(500),
    supabase.from("rutf_thresholds").select("key, value").eq("key", "variance_pct_max"),
  ]);
  const limit = Number(thresholds?.[0]?.value ?? 5);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const names = Object.fromEntries(rows.map((r) => [r.facility_id, r.facility_name]));
  const sorted = [...rows].sort((a, b) => (Number(b.last_variance_pct ?? -1) - Number(a.last_variance_pct ?? -1)) || b.stockout_days - a.stockout_days);
  const watch = (lots ?? []).filter((l) => names[l.facility_id]);

  const overLimit = rows.filter((r) => Number(r.last_variance_pct ?? 0) > limit).length;
  const lowMos = rows.filter((r) => r.months_of_stock !== null && Number(r.months_of_stock) < 1).length;
  const stockedOut = rows.filter((r) => r.stockout_days > 0).length;
  const expired = rows.reduce((n, r) => n + r.expired_balance, 0);

  return (
    <ReportShell
      title="Stock Reconciliation"
      intro={<>Last physical count against the ledger, months of stock, stockout days and expired stock for each store and OTP site — {month.label}. Variance limit {limit}% (10% for hard-to-reach facilities).</>}
      monthKey={month.key} lgas={lgas} sp={sp}
    >
      <SummaryTiles items={[
        { label: `Last count over ${limit}%`, value: fmt(overLimit), sub: `of ${fmt(rows.length)} facilities` },
        { label: "Under 1 month of stock", value: fmt(lowMos) },
        { label: "With stockout days", value: fmt(stockedOut), sub: "this month" },
        { label: "Expired sachets on hand", value: fmt(expired) },
      ]} />

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Facility</th><th>Level</th><th>LGA</th>
              <th style={{ textAlign: "right" }}>Last count</th><th style={{ textAlign: "right" }}>Variance</th>
              <th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Months of stock</th>
              <th style={{ textAlign: "right" }}>Stockout days</th><th style={{ textAlign: "right" }}>Expired</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 300).map((r) => (
              <tr key={r.facility_id}>
                <td><FacilityLink id={r.facility_id} name={r.facility_name} /></td>
                <td className="text-muted">{LEVEL_LABEL[r.facility_type]}</td>
                <td>{lgaName[r.lga_id] ?? "—"}</td>
                <td style={{ textAlign: "right" }} className="text-muted">{r.last_count_date ?? "None"}</td>
                <td style={{ textAlign: "right" }}>
                  {r.last_variance_pct === null ? "—" : Number(r.last_variance_pct) > limit ? <Flag level="warning">{fmt(r.last_variance_pct, 1)}%</Flag> : `${fmt(r.last_variance_pct, 1)}%`}
                </td>
                <td style={{ textAlign: "right" }}>{fmt(r.balance)}</td>
                <td style={{ textAlign: "right" }}>
                  {r.months_of_stock === null ? "—" : Number(r.months_of_stock) < 1 ? <Flag level="warning">{fmt(r.months_of_stock, 1)}</Flag> : fmt(r.months_of_stock, 1)}
                </td>
                <td style={{ textAlign: "right" }}>{r.stockout_days > 0 ? <Flag level="critical">{r.stockout_days}</Flag> : 0}</td>
                <td style={{ textAlign: "right" }}>{r.expired_balance > 0 ? <Flag level="critical">{fmt(r.expired_balance)}</Flag> : "—"}</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={9} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No facilities for these filters.</td></tr>}
          </tbody>
        </table>
        {sorted.length > 300 && <div className="text-muted" style={{ fontSize: 12, padding: "10px 16px" }}>Showing the 300 highest-variance facilities of {sorted.length}. Filter by LGA or level to see the rest.</div>}
      </div>

      <div>
        <h3 style={{ fontSize: 15, margin: "4px 0 10px" }}>Expiry watchlist — lots expiring within {EXPIRY_WARN_DAYS} days of {month.end}, or already expired</h3>
        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Facility</th><th>Lot</th><th>Expiry</th><th style={{ textAlign: "right" }}>Balance (sachets)</th></tr></thead>
            <tbody>
              {watch.map((l) => (
                <tr key={`${l.facility_id}-${l.lot_id}`}>
                  <td><FacilityLink id={l.facility_id} name={names[l.facility_id]} /></td>
                  <td>{l.lot_no}</td>
                  <td>{l.expiry_date! < month.end ? <Flag level="critical">Expired {l.expiry_date}</Flag> : l.expiry_date}</td>
                  <td style={{ textAlign: "right" }}>{fmt(l.balance)}</td>
                </tr>
              ))}
              {watch.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 24 }}>Nothing expiring soon.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </ReportShell>
  );
}
