import Link from "next/link";
import { Meter, StatTile, compact } from "@/components/dashboard/Kpi";
import type { Kpis } from "@/lib/queries/kpis";

// The RUTF dashboard's KPI sections (brief §9) for one month, with changes vs the month before.

type Num = number | null | undefined;
const pct = (v: Num, digits = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));

/** Signed change vs the previous month, formatted; direction for colouring. */
function delta(cur: Num, prev: Num, unit = "", digits = 1): { text: string; direction: -1 | 0 | 1 } | undefined {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return undefined;
  const d = Number(cur) - Number(prev);
  const rounded = Number(d.toFixed(digits));
  return {
    text: `${rounded > 0 ? "+" : ""}${Math.abs(rounded) >= 10_000 ? compact(rounded) : rounded.toLocaleString("en-GB", { maximumFractionDigits: digits })}${unit}`,
    direction: rounded > 0 ? 1 : rounded < 0 ? -1 : 0,
  };
}

const LEVELS: { key: "state_store" | "lga_store" | "otp"; label: string }[] = [
  { key: "state_store", label: "State store" },
  { key: "lga_store", label: "LGA stores" },
  { key: "otp", label: "OTP sites" },
];

/** A KPI group's heading, with a link to the page that goes into it. */
function SectionHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", margin: "0 0 6px" }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>{title}</h3>
      <Link href={href} style={{ fontSize: 12.5 }}>{link} <i className="ph ph-arrow-right" aria-hidden="true" /></Link>
    </div>
  );
}

export function KpiSections({ k, p, monthLabel }: { k: Kpis | null; p: Kpis | null; monthLabel: string }) {
  const month = { label: monthLabel };
  const totalSoh = k ? LEVELS.reduce((n, l) => n + (k.stock_on_hand[l.key] ?? 0), 0) : 0;
  const prevSoh = p ? LEVELS.reduce((n, l) => n + (p.stock_on_hand[l.key] ?? 0), 0) : null;
  const losses = (x: Kpis | null) => (x ? x.losses.loss_damaged + x.losses.loss_expired + x.losses.loss_other : null);
  const coverage = k && k.supervision_quarter.to_visit > 0 ? (k.supervision_quarter.visited * 100) / k.supervision_quarter.to_visit : null;
  return (
    <>
      {!k ? (
        <div className="card elev-sm"><p className="text-muted" style={{ margin: 0 }}>The KPIs couldn&apos;t be loaded.</p></div>
      ) : (
        <>
          {/* Hero: stock on hand, by level, with months of stock */}
          <div className="card elev-sm" style={{ padding: "12px 16px", gap: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px", alignItems: "flex-end" }}>
              <div>
                <div className="kpi-label">Stock on hand, all levels — end of {month.label}</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 800, lineHeight: 1.05 }}>
                  {compact(totalSoh)}<span style={{ fontSize: 14, fontWeight: 600, marginLeft: 5, color: "var(--color-neutral-700)" }}>sachets</span>
                </div>
                {prevSoh !== null && (() => {
                  const d = delta(totalSoh, prevSoh, "", 0);
                  return d ? <div className="kpi-sub" style={{ marginTop: 2 }}>{d.text} sachets vs last month</div> : null;
                })()}
              </div>
              {LEVELS.map((l) => {
                const mos = k.months_of_stock[l.key];
                const low = mos !== null && mos !== undefined && mos < 1;
                return (
                  <Link key={l.key} href={`/stock-ledger?type=${l.key === "otp" ? "health_facility" : l.key}`} style={{ textDecoration: "none", color: "inherit", minWidth: 130 }}>
                    <div className="kpi-label">{l.label}</div>
                    <div className="kpi-value" style={{ fontSize: 18 }}>{compact(k.stock_on_hand[l.key] ?? 0)}</div>
                    <div style={{ fontSize: 11, color: low ? "var(--priority-high)" : "var(--color-neutral-700)", fontWeight: low ? 600 : 400 }}>
                      {low && <i className="ph-fill ph-warning" aria-hidden="true" />} {mos === null || mos === undefined ? "—" : mos.toFixed(1)} months of stock{low ? " — under 1 month" : ""}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <section>
            <SectionHead title="Stock position" href="/stock-integrity" link="Stock Reconciliation" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 10 }}>
              <StatTile label="Stockout rate" value={pct(k.stockout_rate_pct)} unit="%" sub="Stores and OTP sites with a day at zero"
                delta={delta(k.stockout_rate_pct, p?.stockout_rate_pct, " pts")} upIsGood={false} href="/stock-ledger?flag=stockout"
                status={(k.stockout_rate_pct ?? 0) > 0 ? { level: "warning", label: "Stockouts this month" } : { level: "good", label: "No stockouts" }} />
              <StatTile label="Mean stock variance" value={pct(k.mean_stock_variance_pct)} unit="%" sub="Month-end counts against the ledger"
                delta={delta(k.mean_stock_variance_pct, p?.mean_stock_variance_pct, " pts")} upIsGood={false} />
              <StatTile label="Expired stock on hand" value={compact(k.expired_on_hand)} unit="sachets" href="/stock-ledger?flag=expired"
                status={k.expired_on_hand > 0 ? { level: "critical", label: "Remove from stock" } : undefined} />
              <StatTile label="Lost or damaged" value={compact(losses(k) ?? 0)} unit="sachets"
                sub={`${compact(k.losses.loss_damaged)} damaged · ${compact(k.losses.loss_expired)} expired · ${compact(k.losses.loss_other)} other`}
                delta={delta(losses(k), losses(p), "", 0)} upIsGood={false} />
              <StatTile label="Transfers in transit" value={compact(k.transfers_in_transit)} sub="At the end of the month" href="/transfers?status=in_transit" />
              <StatTile label="Received with a discrepancy" value={compact(k.transfers_with_discrepancy)} sub="Transfers received this month"
                delta={delta(k.transfers_with_discrepancy, p?.transfers_with_discrepancy, "", 0)} upIsGood={false} href="/transfers?status=discrepancy" />
            </div>
          </section>

          <section>
            <SectionHead title="Last-mile dispensing and verification" href="/otp-dispensing" link="Last-Mile Dispensing" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 10 }}>
              <StatTile label="Short-dispensing" value={pct(k.short_dispensing_pct)} unit="%" sub="Prescribed but not dispensed (negative: more dispensed)"
                delta={delta(k.short_dispensing_pct, p?.short_dispensing_pct, " pts")} upIsGood={false}
                status={(k.short_dispensing_pct ?? 0) > 5 ? { level: "warning", label: "Above the 5% limit" } : undefined} />
              <StatTile label="OTP verification factor (median)" value={k.otp_vf_median === null ? "—" : Number(k.otp_vf_median).toFixed(2)}
                sub="Register count ÷ app dispensing, at visits this month" />
              <StatTile label="Verifications outside 0.90–1.10" value={pct(k.otp_vf_outside_pct)} unit="%"
                delta={delta(k.otp_vf_outside_pct, p?.otp_vf_outside_pct, " pts")} upIsGood={false}
                status={(k.otp_vf_outside_pct ?? 0) > 0 ? { level: "warning", label: "Dispensing gaps raised" } : undefined} />
            </div>
          </section>

          <section>
            <SectionHead title="Reporting and supervision" href="/reporting-completeness" link="Completeness & Timeliness" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10 }}>
              <Meter label="Daily dispensing reported" pct={k.dispensing_completeness_pct === null ? null : Number(k.dispensing_completeness_pct)}
                sub="OTP-weeks with at least one entry" warnBelow={90} criticalBelow={75} />
              <Meter label="Month-end counts on time" pct={k.count_on_time_pct === null ? null : Number(k.count_on_time_pct)}
                sub="Counted by the due day of the next month" warnBelow={90} criticalBelow={75} />
              <Meter label="Supervision coverage this quarter" pct={coverage}
                sub={`${k.supervision_quarter.visited} of ${k.supervision_quarter.to_visit} stores and OTP sites visited`} warnBelow={80} criticalBelow={50} />
            </div>
          </section>

          <section>
            <SectionHead title="Findings and corrective action" href="/action-tracker" link="Corrective Action Tracker" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 10 }}>
              <StatTile label="Open critical Findings" value={compact(k.open_critical_findings)} href="/issues?priority=critical"
                status={k.open_critical_findings > 0 ? { level: "critical", label: "Needs review" } : { level: "good", label: "None open" }} />
              <StatTile label="Open Findings" value={compact(k.open_findings)} href="/issues" />
              <StatTile label="Median days to close" value={k.median_days_to_close === null ? "—" : String(k.median_days_to_close)} unit={k.median_days_to_close === null ? undefined : "days"}
                sub={k.median_days_to_close === null ? "No Finding closed yet" : "From report to verified closure"} />
            </div>
          </section>
        </>
      )}
    </>
  );
}
