import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getKpis, latestLedgerMonth, monthOf, previousMonth } from "@/lib/queries/kpis";
import { getFacilityMetrics } from "@/lib/queries/metrics";
import { getFindingTargetDays } from "@/lib/queries/issues";
import { getLgas } from "@/lib/queries/lookups";
import { OPEN_STATUSES } from "@/lib/constants";
import { attentionItems } from "@/components/dashboard/AttentionPanel";
import { compact } from "@/components/dashboard/Kpi";
import { monthChoices } from "@/components/reports/ReportShell";
import { PrintButton } from "@/components/reports/PrintButton";

export const metadata: Metadata = { title: "Monthly Programme Report" };

// Monthly Programme Report (DECISIONS R92): a one-page summary of the month for the State, LGAs and
// partners, written from live data — the headline in plain sentences, stock, last-mile dispensing,
// reporting and supervision, Findings and accountability, DHIS2 agreement, the LGAs needing support
// and the actions for next month. Printable (or saved as PDF from the print dialog). Aggregate
// figures only; RLS scopes everything to the reader.

const DAY = 86_400_000;
const n = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (a: number, b: number) => (b ? (a * 100) / b : null);

/** Command Centre button labels, worded for a written report. */
const REPORT_ACTION: Record<string, string> = { "See where": "Investigate stockouts", "Check OTPs": "Check OTP dispensing", "Chase reports": "Chase missing reports" };

/** The time "now" for the Finding target — read once per request (a server component). */
const requestTime = () => Date.now();

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ breakInside: "avoid", display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 15, margin: 0, color: "var(--color-accent-800)", borderBottom: "2px solid var(--color-accent-200)", paddingBottom: 4 }}>
        {num}. {title}
      </h3>
      {children}
    </section>
  );
}

function Figures({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
      {items.map((i) => (
        <div key={i.label} style={{ border: "1px solid var(--color-divider)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>{i.label}</div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 700 }}>{i.value}</div>
          {i.sub && <div className="text-muted" style={{ fontSize: 11 }}>{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const latest = await latestLedgerMonth(supabase);
  const monthKey = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : latest;
  const month = monthOf(monthKey);
  const now = requestTime();

  const [k, p, metrics, lgas, targetDays, dhis2, all, closedAll, raisedInMonth, closedInMonth] = await Promise.all([
    getKpis(supabase, month),
    getKpis(supabase, previousMonth(monthKey)),
    getFacilityMetrics(supabase, month, {}),
    getLgas(supabase),
    getFindingTargetDays(supabase),
    supabase.rpc("dhis2_triangulation", { p_start: month.start, p_end: month.end }),
    supabase.from("issues").select("id", { count: "exact", head: true }),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "verified_closed"),
    supabase.from("issues").select("id", { count: "exact", head: true }).gte("reported_at", month.start).lte("reported_at", `${month.end}T23:59:59`),
    supabase.from("issue_history").select("issue_id", { count: "exact", head: true }).eq("action", "Verified and closed")
      .gte("occurred_at", month.start).lte("occurred_at", `${month.end}T23:59:59`),
  ]);
  const { count: pastTarget } = await supabase.from("issues").select("id", { count: "exact", head: true })
    .in("status", OPEN_STATUSES).lt("reported_at", new Date(now - targetDays * DAY).toISOString());

  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const otps = metrics.filter((m) => m.is_otp_site);
  const sum = (rs: typeof metrics, key: "children_seen" | "new_admissions" | "sachets_dispensed" | "sachets_prescribed") => rs.reduce((t, r) => t + r[key], 0);
  const seen = sum(otps, "children_seen");
  const admissions = sum(otps, "new_admissions");
  const dispensed = sum(otps, "sachets_dispensed");
  const prescribed = sum(otps, "sachets_prescribed");
  const soh = k ? (k.stock_on_hand.state_store ?? 0) + (k.stock_on_hand.lga_store ?? 0) + (k.stock_on_hand.otp ?? 0) : null;

  const reports = dhis2.data ?? [];
  const agree = reports.filter((r) => r.distributed_diff_pct === null || Math.abs(Number(r.distributed_diff_pct)) <= 10).length;

  const raised = all.count ?? 0;
  const closed = closedAll.count ?? 0;
  const score = raised ? Math.round(50 * (closed / raised) + 50 * (1 - (pastTarget ?? 0) / raised)) : null;

  // LGAs needing support: facilities with a stockout, a count over the limit or short-dispensing, and open critical Findings.
  const byLga = new Map<string, { facilities: number; problems: number; critical: number }>();
  for (const m of metrics) {
    const g = byLga.get(m.lga_id) ?? { facilities: 0, problems: 0, critical: 0 };
    g.facilities += 1;
    if (m.stockout_days > 0 || Number(m.last_variance_pct ?? 0) > 5 || Number(m.short_pct ?? 0) > 5) g.problems += 1;
    g.critical += m.open_critical;
    byLga.set(m.lga_id, g);
  }
  const hotspots = [...byLga].filter(([, g]) => g.problems || g.critical)
    .sort((a, b) => b[1].critical - a[1].critical || b[1].problems - a[1].problems).slice(0, 5);

  const actions = k ? attentionItems(k, pastTarget ?? 0, targetDays) : [];
  const coverage = k && k.supervision_quarter.to_visit ? pct(k.supervision_quarter.visited, k.supervision_quarter.to_visit) : null;
  const generated = new Date(now).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const sohChange = k && p ? (soh ?? 0) - ((p.stock_on_hand.state_store ?? 0) + (p.stock_on_hand.lga_store ?? 0) + (p.stock_on_hand.otp ?? 0)) : null;

  return (
    <div className="report-page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
      <div className="no-print" style={{ width: "100%", maxWidth: 900, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Link href="/reporting" style={{ fontSize: 13 }}><i className="ph ph-arrow-left" aria-hidden="true" /> Programme Reporting</Link>
        <form method="get" style={{ display: "flex", gap: 8 }}>
          <select className="input" name="month" defaultValue={monthKey} aria-label="Month" style={{ minWidth: 170 }}>
            {monthChoices(latest).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button className="btn btn-secondary" type="submit">Show</button>
          <PrintButton />
        </form>
      </div>

      <article className="card elev-sm report-doc" style={{ width: "100%", maxWidth: 900, padding: "28px 32px", gap: 18 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", borderBottom: "3px solid var(--color-accent-600)", paddingBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>RUTF Monthly Programme Report</div>
            <h1 style={{ fontSize: 26, margin: "4px 0 0" }}>Katsina State · {month.label}</h1>
          </div>
          <div className="text-muted" style={{ fontSize: 12, textAlign: "right" }}>
            Generated {generated}<br />from the RUTF-DTAP Monitoring Platform<br />Aggregate figures only; no child-level data
          </div>
        </header>

        <Section num={1} title="Summary">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>
            In {month.label}, <strong>{n(dispensed)} sachets</strong> of RUTF were dispensed at {n(otps.length)} OTP sites
            ({prescribed ? `${n(pct(dispensed, prescribed), 1)}% of the ${n(prescribed)} prescribed` : "no prescriptions recorded"}), across{" "}
            <strong>{n(seen)} child visits</strong>, including <strong>{n(admissions)} new admissions</strong> for severe acute malnutrition.
            {soh !== null && <> Stock on hand at month end was <strong>{compact(soh)} sachets</strong>{sohChange !== null ? ` (${sohChange >= 0 ? "up" : "down"} ${compact(Math.abs(sohChange))} on the previous month)` : ""}.</>}
            {k && <> Daily dispensing was reported for {n(k.dispensing_completeness_pct, 1)}% of OTP-weeks and {n(k.count_on_time_pct, 1)}% of month-end counts were on time.</>}
            {" "}{n(raisedInMonth.count)} Findings were raised and {n(closedInMonth.count)} verified and closed this month;
            {" "}{n(pastTarget)} remain open past the {targetDays}-day target.
            {reports.length > 0 && <> {n(pct(agree, reports.length), 1)}% of DHIS2 reports agreed with the ledger.</>}
          </p>
        </Section>

        <Section num={2} title="Stock position">
          <Figures items={[
            { label: "Stock on hand", value: soh === null ? "—" : `${compact(soh)}`, sub: "sachets, all levels" },
            { label: "State store", value: k ? `${n(k.months_of_stock.state_store, 1)} mo` : "—", sub: "months of stock" },
            { label: "LGA stores", value: k ? `${n(k.months_of_stock.lga_store, 1)} mo` : "—", sub: "months of stock" },
            { label: "OTP sites", value: k ? `${n(k.months_of_stock.otp, 1)} mo` : "—", sub: "months of stock" },
            { label: "Stockout rate", value: k ? `${n(k.stockout_rate_pct, 1)}%` : "—", sub: "facilities with a day at zero" },
            { label: "Expired on hand", value: k ? compact(k.expired_on_hand) : "—", sub: "sachets" },
          ]} />
        </Section>

        <Section num={3} title="Last-mile dispensing">
          <Figures items={[
            { label: "Child visits", value: n(seen) },
            { label: "New admissions", value: n(admissions) },
            { label: "Sachets dispensed", value: compact(dispensed), sub: `of ${compact(prescribed)} prescribed` },
            { label: "Short-dispensing", value: k ? `${n(k.short_dispensing_pct, 1)}%` : "—", sub: "limit 5%" },
            { label: "Register checks out of range", value: k ? `${n(k.otp_vf_outside_pct, 1)}%` : "—", sub: "at this month's visits" },
          ]} />
        </Section>

        <Section num={4} title="Reporting and supervision">
          <Figures items={[
            { label: "Daily dispensing reported", value: k ? `${n(k.dispensing_completeness_pct, 1)}%` : "—", sub: "of OTP-weeks · target 90%" },
            { label: "Month-end counts on time", value: k ? `${n(k.count_on_time_pct, 1)}%` : "—", sub: "target 90%" },
            { label: "Supervision coverage", value: coverage === null ? "—" : `${n(coverage, 1)}%`, sub: k ? `${n(k.supervision_quarter.visited)} of ${n(k.supervision_quarter.to_visit)} this quarter` : undefined },
            { label: "Mean count variance", value: k ? `${n(k.mean_stock_variance_pct, 1)}%` : "—", sub: "counts vs ledger" },
          ]} />
        </Section>

        <Section num={5} title="Findings and accountability">
          <Figures items={[
            { label: "Raised this month", value: n(raisedInMonth.count) },
            { label: "Closed this month", value: n(closedInMonth.count), sub: "verified by a supervisor" },
            { label: "Open", value: n(k?.open_findings), sub: `${n(k?.open_critical_findings)} critical` },
            { label: `Open past ${targetDays} days`, value: n(pastTarget) },
            { label: "Accountability score", value: score === null ? "—" : `${score} / 100`, sub: "closure and timeliness" },
          ]} />
        </Section>

        <Section num={6} title="Data quality: DHIS2 triangulation">
          <p style={{ margin: 0, fontSize: 13.5 }}>
            {reports.length
              ? <>{n(reports.length)} DHIS2 reports for {month.label}; <strong>{n(pct(agree, reports.length), 1)}%</strong> agree with the ledger on distribution (within 10%), {n(reports.length - agree)} differ and are listed for review in DHIS2 Triangulation.</>
              : <>No DHIS2 reports loaded for {month.label}.</>}
          </p>
        </Section>

        <Section num={7} title="LGAs needing support">
          {hotspots.length ? (
            <table className="table">
              <thead><tr><th>LGA</th><th style={{ textAlign: "right" }}>Facilities</th><th style={{ textAlign: "right" }}>With a stock or dispensing problem</th><th style={{ textAlign: "right" }}>Open critical Findings</th></tr></thead>
              <tbody>
                {hotspots.map(([id, g]) => (
                  <tr key={id}>
                    <td>{lgaName[id] ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{n(g.facilities)}</td>
                    <td style={{ textAlign: "right" }}>{n(g.problems)}</td>
                    <td style={{ textAlign: "right" }}>{n(g.critical)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ margin: 0, fontSize: 13.5 }}>No LGA has a stock, dispensing or critical-Finding problem this month.</p>}
          <div className="text-muted" style={{ fontSize: 11.5 }}>Problem = a stockout day, a count more than 5% from the ledger, or short-dispensing over 5%. For review, not accusation.</div>
        </Section>

        <Section num={8} title="Actions for next month">
          {actions.length ? (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7 }}>
              {actions.map((a) => <li key={a.text}><strong>{REPORT_ACTION[a.action] ?? a.action}:</strong> {a.text}.</li>)}
            </ol>
          ) : <p style={{ margin: 0, fontSize: 13.5 }}>No action needed: every indicator is within its limit.</p>}
        </Section>

        <footer className="text-muted" style={{ fontSize: 11, borderTop: "1px solid var(--color-divider)", paddingTop: 8 }}>
          Definitions as in the platform&apos;s KPIs (Command Centre). Thresholds are set in Master Data → Thresholds. Figures are scoped to the reader&apos;s access.
        </footer>
      </article>
    </div>
  );
}
