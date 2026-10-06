import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth, type FacilityMetric } from "@/lib/queries/metrics";
import { monthOf } from "@/lib/queries/kpis";
import { Meter } from "@/components/dashboard/Kpi";
import { FacilityLink, Flag, LEVEL_LABEL, ReportShell, fmt, type SP } from "@/components/reports/ReportShell";

export const metadata: Metadata = { title: "Completeness & Timeliness" };

// Completeness & Timeliness (brief §9; DECISIONS R88): which OTP sites recorded daily dispensing
// every week, and which stores and OTP sites counted at month end on time — same definitions as
// rutf_kpis() (DECISIONS R38). Headline rates against the 90% target, a 6-month trend, an LGA
// table (lowest first) and the facilities with gaps, saying what is missing.

const TARGET = 90;
const TREND_MONTHS = 6;

type Rates = { weeksSeen: number; weeksExpected: number; onTime: number; facilities: number };

function ratesOf(rows: FacilityMetric[]): Rates {
  const otps = rows.filter((r) => r.is_otp_site);
  return {
    weeksSeen: otps.reduce((n, r) => n + (r.dispensing_weeks ?? 0), 0),
    weeksExpected: otps.reduce((n, r) => n + (r.expected_weeks ?? 0), 0),
    onTime: rows.filter((r) => r.count_on_time).length,
    facilities: rows.length,
  };
}
const pctOf = (n: number, d: number) => (d ? (n * 100) / d : null);
const dispensingPct = (r: Rates) => pctOf(r.weeksSeen, r.weeksExpected);
const countPct = (r: Rates) => pctOf(r.onTime, r.facilities);
/** Both duties together: every expected OTP-week plus every month-end count. */
const overallPct = (r: Rates) => pctOf(r.weeksSeen + r.onTime, r.weeksExpected + r.facilities);
const pctText = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const tone = (v: number | null) => (v === null ? "var(--color-neutral-600)" : v < 75 ? "var(--priority-critical)" : v < TARGET ? "var(--priority-high)" : "var(--status-resolved)");

export default async function ReportingCompletenessPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(Number(month.key.slice(0, 4)), Number(month.key.slice(5, 7)) - 1 - (TREND_MONTHS - 1 - i), 1));
    return monthOf(d.toISOString().slice(0, 7));
  });
  const filters = { level: sp.level, lga: sp.lga };
  const [rows, lgas, ...history] = await Promise.all([
    getFacilityMetrics(supabase, month, filters),
    getProgrammeLgas(supabase),
    ...trendMonths.slice(0, -1).map((m) => getFacilityMetrics(supabase, m, filters)),
  ]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));

  const now = ratesOf(rows);
  const trend = [...history.map(ratesOf), now].map((r, i) => ({
    label: new Date(`${trendMonths[i].key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
    dispensing: dispensingPct(r),
    counts: countPct(r),
  }));

  const missingWeeks = (r: FacilityMetric) => (r.expected_weeks ? Math.max(0, r.expected_weeks - (r.dispensing_weeks ?? 0)) : 0);
  const gap = (r: FacilityMetric) => missingWeeks(r) + (r.count_on_time ? 0 : 1);
  const sorted = [...rows].sort((a, b) => gap(b) - gap(a) || a.facility_name.localeCompare(b.facility_name));
  const missing = sorted.filter((r) => gap(r) > 0);
  const show = sp.all === "1" ? sorted : missing;
  const complete = rows.length - missing.length;

  // By LGA, lowest overall first.
  const byLga = new Map<string, FacilityMetric[]>();
  for (const r of rows) byLga.set(r.lga_id, [...(byLga.get(r.lga_id) ?? []), r]);
  const lgaRows = [...byLga]
    .map(([id, rs]) => ({ id, rates: ratesOf(rs), gaps: rs.filter((r) => gap(r) > 0).length }))
    .sort((a, b) => (overallPct(a.rates) ?? 0) - (overallPct(b.rates) ?? 0) || b.gaps - a.gaps);
  const lgasAtTarget = lgaRows.filter((l) => (overallPct(l.rates) ?? 0) >= TARGET).length;

  const overall = overallPct(now);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== "lga"));
  const lgaHref = (id: string) => `/reporting-completeness?${new URLSearchParams({ ...Object.fromEntries(qs), lga: id }).toString()}`;

  return (
    <ReportShell
      title="Completeness & Timeliness"
      intro={<>Is every facility reporting, and on time? OTP sites record dispensing daily, counted in full weeks of the month ({rows.find((r) => r.is_otp_site)?.expected_weeks ?? 4} for {month.label}); every store and OTP site counts its stock at month end, on time when dated in the last days of the month or by the due day of the next. Target {TARGET}%.</>}
      monthKey={month.key} lgas={lgas} sp={sp}
      extraFilters={
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Show complete facilities too
        </label>
      }
    >
      <div className="kpi-row">
        <div className="card elev-sm kpi-card">
          <div className="kpi-label">Overall reporting rate</div>
          <div className="kpi-value">{pctText(overall)}</div>
          <div style={{ fontSize: 11, color: tone(overall), fontWeight: 600 }}>
            <i className={`ph-fill ${overall !== null && overall >= TARGET ? "ph-check-circle" : "ph-warning"}`} aria-hidden="true" />{" "}
            {overall === null ? "No data" : overall >= TARGET ? `Meets the ${TARGET}% target` : `Below the ${TARGET}% target`}
          </div>
        </div>
        <Meter label="Daily dispensing reported" pct={dispensingPct(now)}
          sub={`${fmt(now.weeksSeen)} of ${fmt(now.weeksExpected)} OTP-weeks`} warnBelow={TARGET} criticalBelow={75} />
        <Meter label="Month-end counts on time" pct={countPct(now)}
          sub={`${fmt(now.onTime)} of ${fmt(now.facilities)} stores and OTP sites`} warnBelow={TARGET} criticalBelow={75} />
        <div className="card elev-sm kpi-card">
          <div className="kpi-label">Facilities reporting in full</div>
          <div className="kpi-value">
            {fmt(complete)}<span className="kpi-unit"> / {fmt(rows.length)}</span>
          </div>
          <div className="kpi-sub">{fmt(lgasAtTarget)} of {fmt(lgaRows.length)} LGAs at or above {TARGET}%</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, alignItems: "start" }}>
        <div className="card elev-sm">
          <div className="card-title">Last {TREND_MONTHS} months</div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, marginTop: 4 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--color-accent-500)", marginRight: 4 }} aria-hidden="true" />Daily dispensing</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--status-resolved)", marginRight: 4 }} aria-hidden="true" />Month-end counts</span>
            <span className="text-muted">Target {TARGET}%</span>
          </div>
          <div role="img" aria-label={trend.map((t) => `${t.label}: dispensing ${pctText(t.dispensing)}, counts ${pctText(t.counts)}`).join("; ")}
            style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 170, marginTop: 10 }}>
            {trend.map((t) => (
              <div key={t.label} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 4 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 2 }}>
                  {([["dispensing", "var(--color-accent-500)"], ["counts", "var(--status-resolved)"]] as const).map(([k, color]) => (
                    <div key={k} title={`${t.label}: ${pctText(t[k])}`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                      <span style={{ fontSize: 9, color: t[k] !== null && t[k]! < TARGET ? "var(--priority-high)" : undefined }}>{t[k] === null ? "" : Math.round(t[k]!)}</span>
                      <div style={{ width: "100%", height: `${((t[k] ?? 0) / 100) * 88}%`, background: color, borderRadius: "4px 4px 0 0" }} />
                    </div>
                  ))}
                </div>
                <div className="text-muted" style={{ fontSize: 11, textAlign: "center" }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">By LGA</div>
            <div className="text-muted" style={{ fontSize: 12 }}>Lowest overall reporting rate first. Click an LGA to see its facilities.</div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>LGA</th><th style={{ textAlign: "right" }}>Overall</th><th style={{ textAlign: "right" }}>Dispensing</th>
                <th style={{ textAlign: "right" }}>Counts</th><th style={{ textAlign: "right" }}>With gaps</th>
              </tr>
            </thead>
            <tbody>
              {lgaRows.slice(0, 10).map((l) => {
                const o = overallPct(l.rates);
                return (
                  <tr key={l.id}>
                    <td><Link href={lgaHref(l.id)}>{lgaName[l.id] ?? "—"}</Link></td>
                    <td style={{ textAlign: "right", color: tone(o), fontWeight: 600 }}>{pctText(o)}</td>
                    <td style={{ textAlign: "right" }}>{pctText(dispensingPct(l.rates))}</td>
                    <td style={{ textAlign: "right" }}>{pctText(countPct(l.rates))}</td>
                    <td style={{ textAlign: "right" }}>{l.gaps ? <Flag level="warning">{l.gaps}</Flag> : 0}</td>
                  </tr>
                );
              })}
              {lgaRows.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No facilities.</td></tr>}
            </tbody>
          </table>
          {lgaRows.length > 10 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 16px 12px" }}>The 10 lowest of {lgaRows.length} LGAs.</div>}
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "14px 16px 0" }}>
          <div className="card-title">{sp.all === "1" ? "Every facility" : "Facilities with gaps"}</div>
          <span className="text-muted" style={{ fontSize: 12 }}>{fmt(show.length)} facilities · most missing first</span>
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr><th>Facility</th><th>LGA</th><th>What is missing</th><th style={{ textAlign: "right" }}>Dispensing weeks</th><th>Month-end count</th></tr>
          </thead>
          <tbody>
            {show.map((r) => {
              const weeks = missingWeeks(r);
              const parts = [weeks ? `${weeks} ${weeks === 1 ? "week" : "weeks"} of daily dispensing` : null, r.count_on_time ? null : "the month-end count"].filter(Boolean);
              return (
                <tr key={r.facility_id}>
                  <td>
                    <FacilityLink id={r.facility_id} name={r.facility_name} />
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{LEVEL_LABEL[r.facility_type]}</div>
                  </td>
                  <td>{lgaName[r.lga_id] ?? "—"}</td>
                  <td>{parts.length ? <Flag level="warning">{parts.join(" and ")}</Flag> : <span style={{ color: "var(--status-resolved)" }}><i className="ph-fill ph-check-circle" aria-hidden="true" /> Nothing</span>}</td>
                  <td style={{ textAlign: "right" }}>{r.expected_weeks === null ? "—" : `${r.dispensing_weeks ?? 0} of ${r.expected_weeks}`}</td>
                  <td>{r.count_on_time ? "On time" : "Missing or late"}</td>
                </tr>
              );
            })}
            {show.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>Every facility reported in full.</td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
