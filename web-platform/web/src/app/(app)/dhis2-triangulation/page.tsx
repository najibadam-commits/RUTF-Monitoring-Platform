import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { reportMonth } from "@/lib/queries/metrics";
import { monthOf, type Month } from "@/lib/queries/kpis";
import { FacilityLink, Flag, ReportShell, fmt, type SP } from "@/components/reports/ReportShell";
import { Dhis2Upload } from "@/components/dhis2/Dhis2Upload";

export const metadata: Metadata = { title: "DHIS2 Triangulation" };

// DHIS2 Triangulation (brief §9; DECISIONS R91): does the national HMIS tell the same story as the
// ledger? Each OTP site's DHIS2 monthly report beside the ledger for the same month — received,
// distributed (dispensed + issued), wasted (losses) and stockout days — from dhis2_triangulation()
// (migration 0105). Agreement rate, per-indicator agreement, DHIS2 coverage, a 6-month trend, an
// LGA roll-up and one status per facility (DHIS2 higher / lower than the ledger), filterable.

const LIMIT = 10;
const TREND_MONTHS = 6;

type Row = {
  facility_id: string; facility_name: string; lga_id: string; period: string;
  dhis2_received: number | null; ledger_received: number;
  dhis2_distributed: number | null; ledger_distributed: number;
  dhis2_wasted: number | null; ledger_wasted: number;
  dhis2_stockout_days: number | null; ledger_stockout_days: number;
  distributed_diff_pct: number | null;
};
type Flagged = "higher" | "lower" | "other" | "ok";

function pair(dhis2: number | null, ledger: number, differs = false) {
  return (
    <span style={differs ? { color: "var(--priority-high)", fontWeight: 600 } : undefined}>
      {dhis2 === null ? "—" : fmt(dhis2)} <span className="text-muted" style={{ fontWeight: 400 }}>/ {fmt(ledger)}</span>
    </span>
  );
}

const diff = (r: Row) => (r.distributed_diff_pct === null ? null : Number(r.distributed_diff_pct));
const receivedDiffers = (r: Row) => r.dhis2_received !== null && Number(r.dhis2_received) !== Number(r.ledger_received);
const wastedDiffers = (r: Row) => r.dhis2_wasted !== null && Number(r.dhis2_wasted) !== Number(r.ledger_wasted);
const stockoutDiffers = (r: Row) => r.dhis2_stockout_days !== null && Number(r.dhis2_stockout_days) !== Number(r.ledger_stockout_days);

function flagOf(r: Row): Flagged {
  const d = diff(r);
  if (d !== null && d > LIMIT) return "higher";
  if (d !== null && d < -LIMIT) return "lower";
  if (receivedDiffers(r) || wastedDiffers(r) || stockoutDiffers(r)) return "other";
  return "ok";
}

const STATUS: Record<Flagged, { label: string; sub: string; level: "warning" | "info" | "good"; icon: string }> = {
  higher: { label: `DHIS2 distribution higher by ${LIMIT}%+`, sub: "Reported more than the ledger shows", level: "warning", icon: "ph-trend-up" },
  lower: { label: `DHIS2 distribution lower by ${LIMIT}%+`, sub: "Reported less than the ledger shows", level: "warning", icon: "ph-trend-down" },
  other: { label: "Other figures differ", sub: "Received, wasted or stockout days", level: "info", icon: "ph-git-diff" },
  ok: { label: "Matches the ledger", sub: `Distribution within ${LIMIT}%, other figures equal`, level: "good", icon: "ph-check-circle" },
};
const COLOR = { warning: "var(--priority-high)", info: "var(--color-accent-700)", good: "var(--status-resolved)" } as const;
const pctText = (n: number, d: number) => (d ? `${fmt((n * 100) / d, 1)}%` : "—");

export default async function Dhis2TriangulationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const trendMonths: Month[] = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(Number(month.key.slice(0, 4)), Number(month.key.slice(5, 7)) - 1 - (TREND_MONTHS - 1 - i), 1));
    return monthOf(d.toISOString().slice(0, 7));
  });
  const [lgas, { count: otpSites }, ...results] = await Promise.all([
    getProgrammeLgas(supabase),
    (() => {
      let q = supabase.from("facilities").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_otp_site", true);
      if (sp.lga) q = q.eq("lga_id", sp.lga);
      return q;
    })(),
    ...trendMonths.map((m) => supabase.rpc("dhis2_triangulation", { p_start: m.start, p_end: m.end })),
  ]);
  const { data, error } = results[results.length - 1];
  const byLgaFilter = (rs: Row[]) => rs.filter((r) => !sp.lga || r.lga_id === sp.lga);
  const rows = byLgaFilter((data ?? []) as Row[]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const isAdmin = ["super_admin", "project_admin"].includes(profile.role);

  const flagged = rows.map((r) => ({ r, flag: flagOf(r) }));
  const countOf = (k: Flagged) => flagged.filter((x) => x.flag === k).length;
  const within = rows.filter((r) => diff(r) === null || Math.abs(diff(r)!) <= LIMIT).length;
  const filter = (["higher", "lower", "other", "ok"] as const).includes(sp.flag as Flagged) ? (sp.flag as Flagged) : null;
  const order: Flagged[] = ["higher", "lower", "other", "ok"];
  const shown = flagged
    .filter((x) => (filter ? x.flag === filter : sp.all === "1" || x.flag !== "ok"))
    .sort((a, b) => order.indexOf(a.flag) - order.indexOf(b.flag) || Math.abs(diff(b.r) ?? 0) - Math.abs(diff(a.r) ?? 0));

  const sum = (k: "dhis2_distributed" | "ledger_distributed") => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const indicators = [
    { label: "Received", agree: rows.filter((r) => r.dhis2_received !== null && !receivedDiffers(r)).length, of: rows.filter((r) => r.dhis2_received !== null).length, rule: "equal" },
    { label: "Distributed", agree: rows.filter((r) => diff(r) !== null && Math.abs(diff(r)!) <= LIMIT).length, of: rows.filter((r) => diff(r) !== null).length, rule: `within ${LIMIT}%` },
    { label: "Wasted", agree: rows.filter((r) => r.dhis2_wasted !== null && !wastedDiffers(r)).length, of: rows.filter((r) => r.dhis2_wasted !== null).length, rule: "equal" },
    { label: "Stockout days", agree: rows.filter((r) => r.dhis2_stockout_days !== null && !stockoutDiffers(r)).length, of: rows.filter((r) => r.dhis2_stockout_days !== null).length, rule: "equal" },
  ];

  const trend = results.map((res, i) => {
    const rs = byLgaFilter((res.data ?? []) as Row[]);
    const ok = rs.filter((r) => diff(r) === null || Math.abs(diff(r)!) <= LIMIT).length;
    return { label: new Date(`${trendMonths[i].key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), n: rs.length, pct: rs.length ? (ok * 100) / rs.length : null };
  });

  const byLga = new Map<string, Row[]>();
  for (const r of rows) byLga.set(r.lga_id, [...(byLga.get(r.lga_id) ?? []), r]);
  const lgaRows = [...byLga]
    .map(([id, rs]) => {
      const dd = rs.reduce((n, r) => n + Number(r.dhis2_distributed ?? 0), 0);
      const ld = rs.reduce((n, r) => n + Number(r.ledger_distributed), 0);
      return { id, n: rs.length, off: rs.filter((r) => Math.abs(diff(r) ?? 0) > LIMIT).length, net: ld ? ((dd - ld) * 100) / ld : null };
    })
    .sort((a, b) => b.off / b.n - a.off / a.n || b.off - a.off)
    .slice(0, 10);

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/dhis2-triangulation?${qs}` : "/dhis2-triangulation";
  }

  const agreement = rows.length ? (within * 100) / rows.length : null;

  return (
    <ReportShell
      title="DHIS2 Triangulation"
      intro={<>Does the national HMIS tell the same story as the ledger? Each OTP site&apos;s DHIS2 monthly report for {month.label} beside the platform&apos;s ledger, shown as DHIS2 / ledger. Distributed = dispensed + issued; wasted = recorded losses. A report is flagged when DHIS2 distribution differs from the ledger by more than {LIMIT}%. Differences are for review: they may be data-entry errors in either system, not loss.</>}
      monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
      extraFilters={
        <>
          {sp.flag && <input type="hidden" name="flag" value={sp.flag} />}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Show matching facilities too
          </label>
        </>
      }
    >
      {error && <p style={{ color: "var(--priority-critical)" }}>The comparison couldn&apos;t be loaded.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {[
          { label: "Reports agreeing with the ledger", value: agreement === null ? "—" : `${fmt(agreement, 1)}%`, sub: `${fmt(within)} of ${fmt(rows.length)} within ${LIMIT}% on distribution`, icon: "ph-intersect", tone: agreement !== null && agreement >= 90 ? "var(--status-resolved)" : "var(--priority-high)" },
          { label: "DHIS2 reporting coverage", value: otpSites ? pctText(rows.length, otpSites) : "—", sub: `${fmt(rows.length)} of ${fmt(otpSites ?? 0)} OTP sites reported for ${month.label}`, icon: "ph-cloud-arrow-up" },
          { label: "Distributed per DHIS2", value: fmt(sum("dhis2_distributed")), sub: "sachets", icon: "ph-database" },
          { label: "Distributed per ledger", value: fmt(sum("ledger_distributed")), sub: sum("ledger_distributed") ? `DHIS2 is ${fmt(((sum("dhis2_distributed") - sum("ledger_distributed")) * 100) / sum("ledger_distributed"), 1)}% ${sum("dhis2_distributed") >= sum("ledger_distributed") ? "above" : "below"} overall` : "sachets", icon: "ph-book-open-text" },
        ].map((t) => (
          <div key={t.label} className="card elev-sm" style={{ padding: 14, gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
              <i className={`ph-fill ${t.icon}`} aria-hidden="true" style={{ fontSize: 15, color: t.tone ?? "var(--color-accent-600)" }} /> {t.label}
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{t.value}</div>
            <div className="text-muted" style={{ fontSize: 11.5 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <div className="card elev-sm">
          <div className="card-title">Agreement by indicator</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Share of DHIS2 reports that agree with the ledger, {month.label}.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {indicators.map((x) => {
              const p = x.of ? (x.agree * 100) / x.of : 0;
              return (
                <div key={x.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span>{x.label} <span className="text-muted">({x.rule})</span></span>
                    <span>{x.of ? `${fmt(p, 1)}%` : "—"} <span className="text-muted">· {fmt(x.agree)} of {fmt(x.of)}</span></span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--color-accent-100)" }}>
                    <div style={{ height: "100%", width: `${p}%`, borderRadius: 4, background: p >= 90 ? "var(--color-accent-500)" : "var(--priority-high)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card elev-sm">
          <div className="card-title">Agreement, last {TREND_MONTHS} months</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Share of DHIS2 reports within {LIMIT}% of the ledger on distribution.</div>
          <div role="img" aria-label={trend.map((t) => `${t.label}: ${t.pct === null ? "no reports" : t.pct.toFixed(1) + "%"}`).join("; ")}
            style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, marginTop: 10 }}>
            {trend.map((t) => (
              <div key={t.label} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10.5 }}>{t.pct === null ? "" : `${Math.round(t.pct)}%`}</span>
                <div title={`${t.label}: ${t.n} reports`} style={{ width: "70%", height: `${((t.pct ?? 0) / 100) * 80}%`, background: "var(--color-accent-500)", borderRadius: "4px 4px 0 0" }} />
                <div className="text-muted" style={{ fontSize: 11 }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">By LGA</div>
            <div className="text-muted" style={{ fontSize: 12 }}>Highest share of reports over {LIMIT}% apart first.</div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead><tr><th>LGA</th><th style={{ textAlign: "right" }}>Reports</th><th style={{ textAlign: "right" }}>Over {LIMIT}%</th><th style={{ textAlign: "right" }}>DHIS2 vs ledger</th></tr></thead>
            <tbody>
              {lgaRows.map((l) => (
                <tr key={l.id}>
                  <td><Link href={hrefWith({ lga: l.id })}>{lgaName[l.id] ?? "—"}</Link></td>
                  <td style={{ textAlign: "right" }}>{fmt(l.n)}</td>
                  <td style={{ textAlign: "right" }}>{l.off ? <Flag level="warning">{l.off}</Flag> : 0}</td>
                  <td style={{ textAlign: "right" }}>{l.net === null ? "—" : `${l.net > 0 ? "+" : ""}${fmt(l.net, 1)}%`}</td>
                </tr>
              ))}
              {lgaRows.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No DHIS2 reports.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {order.map((k) => {
          const st = STATUS[k];
          const active = filter === k;
          return (
            <Link key={k} href={hrefWith({ flag: active ? null : k })} className="card elev-sm" aria-pressed={active}
              title={active ? "Show all flagged reports" : `List: ${st.label.toLowerCase()}`}
              style={{ padding: "10px 12px", gap: 0, textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
                <i className={`ph-fill ${st.icon}`} aria-hidden="true" style={{ fontSize: 15, color: COLOR[st.level] }} /> {st.label}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 700 }}>{fmt(countOf(k))}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{active ? "Filtered · click to clear" : st.sub}</div>
            </Link>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "14px 16px 0" }}>
          <div className="card-title">{filter ? STATUS[filter].label : sp.all === "1" ? "Every DHIS2 report" : "Reports that differ from the ledger"}</div>
          <span className="text-muted" style={{ fontSize: 12 }}>{fmt(shown.length)} OTP sites · largest differences first · DHIS2 / ledger</span>
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Facility</th><th>Status</th><th style={{ textAlign: "right" }}>Received</th><th style={{ textAlign: "right" }}>Distributed</th>
              <th style={{ textAlign: "right" }}>Difference</th><th style={{ textAlign: "right" }}>Wasted</th><th style={{ textAlign: "right" }}>Stockout days</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, flag }) => {
              const d = diff(r);
              const label = d === null ? "—" : `${d > 0 ? "+" : ""}${fmt(d, 1)}%`;
              const st = STATUS[flag];
              return (
                <tr key={`${r.facility_id}-${r.period}`}>
                  <td>
                    <FacilityLink id={r.facility_id} name={r.facility_name} />
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{lgaName[r.lga_id] ?? "—"}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: COLOR[st.level], fontWeight: 600, fontSize: 12.5 }}>
                    <i className={`ph-fill ${st.icon}`} aria-hidden="true" /> {flag === "higher" ? "DHIS2 higher" : flag === "lower" ? "DHIS2 lower" : flag === "other" ? "Other figures differ" : "Matches"}
                  </td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_received, r.ledger_received, receivedDiffers(r))}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_distributed, r.ledger_distributed, d !== null && Math.abs(d) > LIMIT)}</td>
                  <td style={{ textAlign: "right" }}>{d !== null && Math.abs(d) > LIMIT ? <Flag level="warning">{label}</Flag> : label}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_wasted, r.ledger_wasted, wastedDiffers(r))}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_stockout_days, r.ledger_stockout_days, stockoutDiffers(r))}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  {rows.length === 0 ? `No DHIS2 reports loaded for ${month.label}.` : "Every DHIS2 report matches the ledger."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <details className="card elev-sm" style={{ padding: 0 }}>
          <summary style={{ cursor: "pointer", padding: "12px 16px", fontWeight: 600 }}>
            <i className="ph ph-upload-simple" aria-hidden="true" /> Load a DHIS2 extract <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>· administrators</span>
          </summary>
          <div style={{ padding: "0 12px 12px" }}><Dhis2Upload /></div>
        </details>
      )}
    </ReportShell>
  );
}
