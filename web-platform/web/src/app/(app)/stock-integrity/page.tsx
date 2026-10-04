import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth, type FacilityMetric } from "@/lib/queries/metrics";
import { FacilityLink, Flag, LEVEL_LABEL, ReportShell, fmt, type SP } from "@/components/reports/ReportShell";

export const metadata: Metadata = { title: "Stock Reconciliation" };

// Stock Reconciliation (brief §9; DECISIONS R87): does each store's and OTP site's stock add up?
// Last physical count against the ledger, months of stock, stockout days and expired stock from
// facility_metrics() (migration 0105), with one status per facility (worst first), clickable status
// tiles that filter the list (?flag=), an LGA roll-up and the expiry watchlist (use first-expiring
// lots first).

const EXPIRY_WARN_DAYS = 90;
const DAY = 86_400_000;
const SHOWN = 300;

type Flagged = "expired" | "stockout" | "over" | "notcounted" | "lowmos" | "ok";

const STATUS: Record<Flagged, { label: string; level: "critical" | "warning" | "good"; icon: string }> = {
  expired: { label: "Expired stock on hand", level: "critical", icon: "ph-calendar-x" },
  stockout: { label: "Stocked out", level: "critical", icon: "ph-prohibit" },
  over: { label: "Count over the limit", level: "warning", icon: "ph-scales" },
  notcounted: { label: "Not counted this month", level: "warning", icon: "ph-clipboard" },
  lowmos: { label: "Under 1 month of stock", level: "warning", icon: "ph-package" },
  ok: { label: "Reconciled", level: "good", icon: "ph-check-circle" },
};
const LEVEL_COLOR = { critical: "var(--priority-critical)", warning: "var(--priority-high)", good: "var(--status-resolved)" } as const;

export default async function StockIntegrityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [rows, lgas, { data: lots }, { data: thresholds }] = await Promise.all([
    getFacilityMetrics(supabase, month, { level: sp.level, lga: sp.lga }),
    getLgas(supabase),
    supabase.from("stock_balances").select("facility_id, lot_id, lot_no, expiry_date, balance").gt("balance", 0).not("expiry_date", "is", null)
      .lte("expiry_date", new Date(Date.parse(month.end) + EXPIRY_WARN_DAYS * DAY).toISOString().slice(0, 10))
      .order("expiry_date").limit(500),
    supabase.from("rutf_thresholds").select("key, value").eq("key", "variance_pct_max"),
  ]);
  const limit = Number(thresholds?.[0]?.value ?? 5);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const byId = Object.fromEntries(rows.map((r) => [r.facility_id, r]));

  /** Counted for this month: a count dated in the month, or on time by the next month's due day. */
  const counted = (r: FacilityMetric) => r.count_on_time || (r.last_count_date !== null && r.last_count_date >= month.start);
  const over = (r: FacilityMetric) => Number(r.last_variance_pct ?? 0) > limit;
  const lowMos = (r: FacilityMetric) => r.months_of_stock !== null && Number(r.months_of_stock) < 1;
  /** Every flag that applies, worst first; "ok" when none. */
  const flagsOf = (r: FacilityMetric): Flagged[] => {
    const f: Flagged[] = [];
    if (r.expired_balance > 0) f.push("expired");
    if (r.stockout_days > 0) f.push("stockout");
    if (counted(r) && over(r)) f.push("over");
    if (!counted(r)) f.push("notcounted");
    if (lowMos(r)) f.push("lowmos");
    return f.length ? f : ["ok"];
  };
  const order: Flagged[] = ["expired", "stockout", "over", "notcounted", "lowmos", "ok"];
  const flagged = rows.map((r) => ({ r, flags: flagsOf(r) }));
  const countOf = (k: Flagged) => flagged.filter((x) => x.flags.includes(k)).length;

  const filter = order.includes(sp.flag as Flagged) ? (sp.flag as Flagged) : null;
  const shown = flagged
    .filter((x) => !filter || x.flags.includes(filter))
    .sort((a, b) => order.indexOf(a.flags[0]) - order.indexOf(b.flags[0]) || Number(b.r.last_variance_pct ?? -1) - Number(a.r.last_variance_pct ?? -1) || b.r.stockout_days - a.r.stockout_days);

  const reconciled = flagged.filter((x) => counted(x.r) && !over(x.r)).length;
  const expiredSachets = rows.reduce((n, r) => n + r.expired_balance, 0);
  const watch = (lots ?? []).filter((l) => byId[l.facility_id]);
  const expiringSachets = watch.filter((l) => l.expiry_date! >= month.end).reduce((n, l) => n + l.balance, 0);

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/stock-integrity?${qs}` : "/stock-integrity";
  }

  const tiles: { key: Flagged; value: string; sub: string; label: string }[] = [
    { key: "ok", label: `Reconciled within ${limit}%`, value: rows.length ? `${Math.round((reconciled * 100) / rows.length)}%` : "—", sub: `${fmt(reconciled)} of ${fmt(rows.length)} counted and within the limit` },
    { key: "over", label: `Count over ${limit}%`, value: fmt(countOf("over")), sub: "Last count differs from the ledger" },
    { key: "notcounted", label: "Not counted this month", value: fmt(countOf("notcounted")), sub: "No physical count recorded" },
    { key: "stockout", label: "Stocked out", value: fmt(countOf("stockout")), sub: "At least one day at zero" },
    { key: "lowmos", label: "Under 1 month of stock", value: fmt(countOf("lowmos")), sub: "Re-supply needed" },
    { key: "expired", label: "Expired stock on hand", value: fmt(expiredSachets), sub: `sachets at ${fmt(countOf("expired"))} facilities` },
  ];

  // LGA roll-up: where stock doesn't add up, most problems first.
  const byLga = new Map<string, { n: number; counted: number; over: number; stockout: number; expired: number }>();
  for (const { r } of flagged) {
    const g = byLga.get(r.lga_id) ?? { n: 0, counted: 0, over: 0, stockout: 0, expired: 0 };
    g.n += 1;
    if (counted(r)) g.counted += 1;
    if (counted(r) && over(r)) g.over += 1;
    if (r.stockout_days > 0) g.stockout += 1;
    g.expired += r.expired_balance;
    byLga.set(r.lga_id, g);
  }
  const lgaRows = [...byLga].sort((a, b) => b[1].over + b[1].stockout - (a[1].over + a[1].stockout) || b[1].expired - a[1].expired).slice(0, 10);

  return (
    <ReportShell
      title="Stock Reconciliation"
      intro={<>Does the stock add up? Each store&apos;s and OTP site&apos;s last physical count against the ledger, with months of stock, stockout days and expired stock, for {month.label}. Variance limit {limit}% (10% for hard-to-reach facilities). Click a tile to list those facilities.</>}
      monthKey={month.key} lgas={lgas} sp={sp}
      extraFilters={sp.flag ? <input type="hidden" name="flag" value={sp.flag} /> : undefined}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {tiles.map((t) => {
          const st = STATUS[t.key];
          const active = filter === t.key;
          return (
            <Link key={t.key} href={hrefWith({ flag: active ? null : t.key })} className="card elev-sm" aria-pressed={active}
              title={active ? "Show all facilities" : `List: ${st.label.toLowerCase()}`}
              style={{ padding: 14, gap: 2, textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
                <i className={`ph-fill ${st.icon}`} aria-hidden="true" style={{ fontSize: 15, color: LEVEL_COLOR[st.level] }} /> {t.label}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{t.value}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>{active ? "Filtered · click to clear" : t.sub}</div>
            </Link>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "14px 16px 0" }}>
          <div className="card-title">{filter ? STATUS[filter].label : "Every store and OTP site"}</div>
          <span className="text-muted" style={{ fontSize: 12 }}>{fmt(shown.length)} facilities · most serious first</span>
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Facility</th><th>Status</th><th>LGA</th>
              <th style={{ textAlign: "right" }}>Last count</th><th style={{ textAlign: "right" }}>Variance</th>
              <th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Months of stock</th>
              <th style={{ textAlign: "right" }}>Stockout days</th><th style={{ textAlign: "right" }}>Expired</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, SHOWN).map(({ r, flags }) => {
              const st = STATUS[flags[0]];
              return (
                <tr key={r.facility_id}>
                  <td>
                    <FacilityLink id={r.facility_id} name={r.facility_name} />
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{LEVEL_LABEL[r.facility_type]}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color: LEVEL_COLOR[st.level], fontWeight: 600, fontSize: 12.5 }}>
                      <i className={`ph-fill ${st.icon}`} aria-hidden="true" /> {st.label}
                    </span>
                    {flags.length > 1 && <div className="text-muted" style={{ fontSize: 11 }}>+{flags.length - 1} more</div>}
                  </td>
                  <td>{lgaName[r.lga_id] ?? "—"}</td>
                  <td style={{ textAlign: "right" }} className="text-muted">{r.last_count_date ?? "None"}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.last_variance_pct === null ? "—" : over(r) ? <Flag level="warning">{fmt(r.last_variance_pct, 1)}%</Flag> : `${fmt(r.last_variance_pct, 1)}%`}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(r.balance)}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.months_of_stock === null ? "—" : lowMos(r) ? <Flag level="warning">{fmt(r.months_of_stock, 1)}</Flag> : fmt(r.months_of_stock, 1)}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.stockout_days > 0 ? <Flag level="critical">{r.stockout_days}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{r.expired_balance > 0 ? <Flag level="critical">{fmt(r.expired_balance)}</Flag> : "—"}</td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={9} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No facilities for these filters.</td></tr>}
          </tbody>
        </table>
        {shown.length > SHOWN && <div className="text-muted" style={{ fontSize: 12, padding: "10px 16px" }}>Showing the {SHOWN} most serious of {fmt(shown.length)}. Filter by LGA, level or a tile to see the rest.</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, alignItems: "start" }}>
        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">By LGA</div>
            <div className="text-muted" style={{ fontSize: 12 }}>Where stock doesn&apos;t add up: counts over the limit and stockouts, most first.</div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>LGA</th><th style={{ textAlign: "right" }}>Counted</th><th style={{ textAlign: "right" }}>Over limit</th>
                <th style={{ textAlign: "right" }}>Stocked out</th><th style={{ textAlign: "right" }}>Expired</th>
              </tr>
            </thead>
            <tbody>
              {lgaRows.map(([id, g]) => (
                <tr key={id}>
                  <td><Link href={hrefWith({ lga: id })}>{lgaName[id] ?? "—"}</Link></td>
                  <td style={{ textAlign: "right" }}>{fmt(g.counted)} / {fmt(g.n)}</td>
                  <td style={{ textAlign: "right" }}>{g.over ? <Flag level="warning">{g.over}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{g.stockout ? <Flag level="critical">{g.stockout}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{g.expired ? <Flag level="critical">{fmt(g.expired)}</Flag> : "—"}</td>
                </tr>
              ))}
              {lgaRows.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No facilities.</td></tr>}
            </tbody>
          </table>
        </div>

        <div id="expiry" className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">Expiry watchlist</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Lots expired or expiring within {EXPIRY_WARN_DAYS} days of {month.end}.{" "}
              {expiringSachets > 0
                ? `${fmt(expiringSachets)} sachets to use first (first-expiry, first-out) before they are lost.`
                : "None expiring soon; expired lots must be removed from stock."}
            </div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead><tr><th>Facility</th><th>Lot</th><th>Expiry</th><th style={{ textAlign: "right" }}>Sachets</th></tr></thead>
            <tbody>
              {watch.slice(0, 50).map((l) => {
                const days = Math.round((Date.parse(l.expiry_date!) - Date.parse(month.end)) / DAY);
                return (
                  <tr key={`${l.facility_id}-${l.lot_id}`}>
                    <td>
                      <FacilityLink id={l.facility_id} name={byId[l.facility_id].facility_name} />
                      <div className="text-muted" style={{ fontSize: 11.5 }}>{lgaName[byId[l.facility_id].lga_id] ?? ""}</div>
                    </td>
                    <td>{l.lot_no}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {days < 0 ? <Flag level="critical">Expired {l.expiry_date}</Flag> : (
                        <>{l.expiry_date}<div style={{ fontSize: 11.5, color: days <= 30 ? "var(--priority-high)" : "var(--color-neutral-600)" }}>in {days} days</div></>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt(l.balance)}</td>
                  </tr>
                );
              })}
              {watch.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 24 }}>Nothing expiring soon.</td></tr>}
            </tbody>
          </table>
          {watch.length > 50 && <div className="text-muted" style={{ fontSize: 12, padding: "10px 16px" }}>Showing the 50 soonest of {fmt(watch.length)} lots.</div>}
        </div>
      </div>
    </ReportShell>
  );
}
