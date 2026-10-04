import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { reportMonth } from "@/lib/queries/metrics";
import { getKpis } from "@/lib/queries/kpis";
import { Meter } from "@/components/dashboard/Kpi";
import { Flag, LEVEL_LABEL, ReportShell, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";

export const metadata: Metadata = { title: "Risk-Based Supervision" };

// Risk-Based Supervision (brief §9; DECISIONS R90): the month's visits (Store Checks and OTP
// Verifications) with coverage, on-site GPS verification and the Findings each raised; and the
// Risk-Based Planner — supervision_plan() (migration 0105): the facilities due, the suggested visits
// up to each supervisor's monthly workload, and the highest-risk facilities with what drives their
// score (facility_risk() components). Exportable as CSV for the supervisors' task lists.

/** facility_risk() component keys → plain names (points out of 100). */
const DRIVERS: Record<string, string> = {
  critical_findings: "Critical Findings",
  stockout: "Stockouts",
  variance: "Count variance",
  vf: "Register check gap",
  short_dispensing: "Short-dispensing",
  reporting: "Late reporting",
  transfers: "Transfer discrepancies",
  since_visit: "Time since last visit",
};

function topDrivers(components: unknown, n = 2) {
  const c = (components ?? {}) as Record<string, unknown>;
  return Object.entries(DRIVERS)
    .map(([k, label]) => ({ label, points: Number(c[k] ?? 0) }))
    .filter((d) => d.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, n);
}

function Drivers({ components }: { components: unknown }) {
  const ds = topDrivers(components);
  if (!ds.length) return <span className="text-muted">—</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {ds.map((d) => (
        <span key={d.label} className="tag tag-outline" style={{ fontSize: 11.5 }} title={`${d.points.toFixed(1)} of the risk points`}>
          {d.label} <span className="text-muted">+{Math.round(d.points)}</span>
        </span>
      ))}
    </span>
  );
}

export default async function SupervisionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  // The Planner needs supervisors' LGA assignments, which RLS shows only to admins and to each
  // supervisor (their own) — other roles get the visit list.
  const canPlan = ["super_admin", "project_admin", "tpm_supervisor"].includes(profile.role);
  const tab = sp.tab === "planner" && canPlan ? "planner" : "visits";
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [lgas, { data: th }] = await Promise.all([
    getProgrammeLgas(supabase),
    supabase.from("rutf_thresholds").select("value").eq("key", "risk_high").limit(1).maybeSingle(),
  ]);
  const riskHigh = Number(th?.value ?? 50);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));

  const tabs = (
    <div className="seg" style={{ width: "fit-content" }}>
      {(canPlan ? (["visits", "planner"] as const) : (["visits"] as const)).map((t) => (
        <Link key={t} href={`/supervision?tab=${t}&month=${month.key}`} className="seg-opt"
          style={{ textDecoration: "none", color: "inherit", ...(tab === t ? { color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-accent)" } : {}) }}>
          {t === "visits" ? "Visits" : "Risk-Based Planner"}
        </Link>
      ))}
    </div>
  );

  if (tab === "planner") {
    const [{ data: plan, error }, { data: risk }] = await Promise.all([
      supabase.rpc("supervision_plan", { p_as_of: month.end }),
      supabase.rpc("facility_risk", { p_as_of: month.end }),
    ]);
    const components = new Map((risk ?? []).map((r) => [r.facility_id, r.components]));
    const rows = (plan ?? []).filter((r) => !sp.lga || r.lga_id === sp.lga);
    const bySupervisor = new Map<string, typeof rows>();
    for (const r of rows) bySupervisor.set(r.supervisor_id, [...(bySupervisor.get(r.supervisor_id) ?? []), r]);
    const suggested = rows.filter((r) => r.suggested).sort((a, b) => b.risk_score - a.risk_score);
    // A facility can sit with more than one supervisor; the risk list shows it once.
    const highest = [...new Map(rows.map((r) => [r.facility_id, r])).values()].sort((a, b) => b.risk_score - a.risk_score).slice(0, 15);
    const highRisk = new Set(rows.filter((r) => r.risk_score >= riskHigh).map((r) => r.facility_id)).size;
    const csvHref = `/supervision/plan.csv?month=${month.key}${sp.lga ? `&lga=${sp.lga}` : ""}`;

    return (
      <ReportShell title="Risk-Based Supervision" monthKey={month.key} lgas={lgas} sp={{ ...sp, tab: "planner" }} showLevel={false}
        intro={<>Supervisors visit where the risk is. Every store and OTP site gets a risk score out of 100 as of {month.end}, from its stockouts, count variance, register checks, short-dispensing, late reporting, transfer discrepancies, critical Findings and time since the last visit. A facility is due when never visited, not visited in 90 days, or high-risk ({riskHigh}+) and not visited in 30 days; the top due ones, up to each supervisor&apos;s monthly workload, are suggested.</>}
        extraFilters={<input type="hidden" name="tab" defaultValue="planner" />}>
        {tabs}
        {error && <p style={{ color: "var(--priority-critical)" }}>The plan couldn&apos;t be loaded.</p>}
        <SummaryTiles items={[
          { label: "Supervisors", value: fmt(bySupervisor.size) },
          { label: `High-risk facilities (${riskHigh}+)`, value: fmt(highRisk) },
          { label: "Facilities due a visit", value: fmt(new Set(rows.filter((r) => r.due).map((r) => r.facility_id)).size) },
          { label: "Suggested visits", value: fmt(suggested.length), sub: "For the supervisors' task lists" },
        ]} />

        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "14px 16px 0" }}>
            <div>
              <div className="card-title">Suggested visits</div>
              <div className="text-muted" style={{ fontSize: 12 }}>Due facilities, highest risk first, within each supervisor&apos;s monthly workload.</div>
            </div>
            <a className="btn btn-secondary" href={csvHref}><i className="ph ph-download-simple" /> Export task lists (CSV)</a>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead><tr><th>Facility</th><th>Supervisor</th><th style={{ textAlign: "right" }}>Risk</th><th>What drives it</th><th>Last visit</th><th>Why due</th></tr></thead>
            <tbody>
              {suggested.map((r) => (
                <tr key={`${r.supervisor_id}-${r.facility_id}`}>
                  <td>
                    <Link href={`/stock-ledger?facility=${r.facility_id}`} style={{ fontWeight: 500 }}>{r.facility_name}</Link>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{LEVEL_LABEL[r.facility_type]} · {lgaName[r.lga_id] ?? "—"}</div>
                  </td>
                  <td>{r.supervisor_name}</td>
                  <td style={{ textAlign: "right" }}>{r.risk_score >= riskHigh ? <Flag level="warning">{r.risk_score}</Flag> : r.risk_score}</td>
                  <td><Drivers components={components.get(r.facility_id)} /></td>
                  <td>{r.last_visit_date ? `${r.last_visit_date} (${r.days_since_visit} d)` : "Never"}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
              {suggested.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 20 }}>No visits due: every facility has been visited within its interval.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "14px 16px 0" }}>
            <div className="card-title">Highest-risk facilities</div>
            <div className="text-muted" style={{ fontSize: 12 }}>The {highest.length} highest risk scores and the two biggest contributors to each, so a supervisor knows what to check first.</div>
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead><tr><th>Facility</th><th style={{ textAlign: "right" }}>Risk</th><th>What drives it</th><th>Last visit</th><th>Supervisor</th></tr></thead>
            <tbody>
              {highest.map((r) => (
                <tr key={r.facility_id}>
                  <td>
                    <Link href={`/stock-ledger?facility=${r.facility_id}`} style={{ fontWeight: 500 }}>{r.facility_name}</Link>
                    <div className="text-muted" style={{ fontSize: 11.5 }}>{LEVEL_LABEL[r.facility_type]} · {lgaName[r.lga_id] ?? "—"}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.risk_score >= riskHigh ? <Flag level="warning">{r.risk_score}</Flag> : r.risk_score}</td>
                  <td><Drivers components={components.get(r.facility_id)} /></td>
                  <td>{r.last_visit_date ? `${r.last_visit_date} (${r.days_since_visit} d)` : "Never"}</td>
                  <td>{r.supervisor_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="card elev-sm" style={{ padding: 0 }}>
          <summary style={{ cursor: "pointer", padding: "14px 16px", fontWeight: 600 }}>
            By supervisor <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>· {bySupervisor.size} supervisors and their facilities ranked by risk</span>
          </summary>
          {[...bySupervisor.values()].map((list) => (
            <div key={list[0].supervisor_id} style={{ borderTop: "1px solid var(--color-divider)", overflowX: "auto" }}>
              <div style={{ padding: "10px 16px", fontWeight: 600 }}>
                {list[0].supervisor_name} <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>· {list.filter((r) => r.suggested).length} suggested of {list.length} facilities</span>
              </div>
              <table className="table">
                <thead><tr><th>#</th><th>Facility</th><th>LGA</th><th style={{ textAlign: "right" }}>Risk</th><th>Last visit</th><th>Why due</th><th></th></tr></thead>
                <tbody>
                  {list.slice(0, 10).map((r) => (
                    <tr key={r.facility_id}>
                      <td className="text-muted">{r.rank}</td>
                      <td><Link href={`/stock-ledger?facility=${r.facility_id}`}>{r.facility_name}</Link></td>
                      <td>{lgaName[r.lga_id] ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{r.risk_score >= riskHigh ? <Flag level="warning">{r.risk_score}</Flag> : r.risk_score}</td>
                      <td>{r.last_visit_date ? `${r.last_visit_date} (${r.days_since_visit} d)` : "Never"}</td>
                      <td>{r.reason ?? <span className="text-muted">Not due</span>}</td>
                      <td>{r.suggested && <span className="tag tag-accent">Suggested</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length > 10 && <div className="text-muted" style={{ fontSize: 12, padding: "0 16px 10px" }}>+ {list.length - 10} more, lower risk.</div>}
            </div>
          ))}
        </details>
      </ReportShell>
    );
  }

  const [{ data: visits }, kpis] = await Promise.all([
    supabase
      .from("monitoring_visits")
      .select("id, code, visit_type, visit_date, facility_id, supervisor_id, distance_to_facility_m, outside_geofence, facility:facilities(name, lga_id)")
      .gte("visit_date", month.start).lte("visit_date", month.end).order("visit_date", { ascending: false }).limit(1000),
    getKpis(supabase, month),
  ]);
  const list = (visits ?? []).filter((v) => !sp.lga || (v.facility as unknown as { lga_id: string } | null)?.lga_id === sp.lga);
  const ids = list.map((v) => v.id);
  const { data: findings } = ids.length ? await supabase.from("issues").select("visit_id").in("visit_id", ids) : { data: [] };
  const raised: Record<string, number> = {};
  for (const f of findings ?? []) if (f.visit_id) raised[f.visit_id] = (raised[f.visit_id] ?? 0) + 1;
  const { data: people } = await supabase.from("profiles").select("id, name").in("id", [...new Set(list.map((v) => v.supervisor_id))]);
  const who = Object.fromEntries((people ?? []).map((p) => [p.id, p.name]));

  const withGps = list.filter((v) => v.distance_to_facility_m !== null);
  const onSite = withGps.filter((v) => !v.outside_geofence).length;
  const findingsRaised = Object.values(raised).reduce((a, b) => a + b, 0);
  const q = kpis?.supervision_quarter;

  return (
    <ReportShell title="Risk-Based Supervision" monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
      intro={<>Store Checks and OTP Verifications recorded in {month.label}: a supervisor counts the stock and checks the registers on site, and every discrepancy becomes a Finding. Each visit is GPS-checked against the facility&apos;s recorded point; more than 150 m away is flagged.</>}>
      {tabs}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        <Meter label="Supervision coverage this quarter" pct={q && q.to_visit ? (q.visited * 100) / q.to_visit : null}
          sub={q ? `${fmt(q.visited)} of ${fmt(q.to_visit)} stores and OTP sites visited` : "—"} warnBelow={80} criticalBelow={50} />
        <Meter label="Visits verified on site by GPS" pct={withGps.length ? (onSite * 100) / withGps.length : null}
          sub={`${fmt(onSite)} of ${fmt(withGps.length)} visits within 150 m of the facility`} warnBelow={95} criticalBelow={85} />
      </div>
      <SummaryTiles items={[
        { label: "Visits this month", value: fmt(list.length) },
        { label: "Store checks", value: fmt(list.filter((v) => v.visit_type === "store_check").length) },
        { label: "OTP verifications", value: fmt(list.filter((v) => v.visit_type === "otp_verification").length) },
        { label: "Findings raised on visits", value: fmt(findingsRaised), sub: list.length ? `${fmt(findingsRaised / list.length, 1)} per visit` : undefined },
      ]} />
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>Visit</th><th>Type</th><th>Facility</th><th>Date</th><th>Supervisor</th><th style={{ textAlign: "right" }}>GPS distance</th><th style={{ textAlign: "right" }}>Findings</th></tr></thead>
          <tbody>
            {list.map((v) => {
              const f = v.facility as unknown as { name: string; lga_id: string } | null;
              return (
                <tr key={v.id}>
                  <td><Link href={`/supervision/${v.id}`} style={{ fontWeight: 500 }}>{v.code}</Link></td>
                  <td className="text-muted">{v.visit_type === "store_check" ? "Store check" : "OTP verification"}</td>
                  <td>{f?.name ?? "—"}<div className="text-muted" style={{ fontSize: 11 }}>{f ? lgaName[f.lga_id] : ""}</div></td>
                  <td>{v.visit_date}</td>
                  <td>{who[v.supervisor_id] ?? <span className="text-muted">Supervisor</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {v.distance_to_facility_m === null ? "—" : v.outside_geofence
                      ? <Flag level="warning">{fmt(v.distance_to_facility_m)} m</Flag>
                      : <span><i className="ph-fill ph-map-pin-area" aria-hidden="true" style={{ color: "var(--status-resolved)" }} /> {fmt(v.distance_to_facility_m)} m</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{raised[v.id] ? <Link href={`/issues?visit=${v.id}`}>{raised[v.id]}</Link> : 0}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No visits in {month.label}.</td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
