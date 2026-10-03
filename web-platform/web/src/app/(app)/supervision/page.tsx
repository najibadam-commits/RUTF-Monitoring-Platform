import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { reportMonth } from "@/lib/queries/metrics";
import { Flag, LEVEL_LABEL, ReportShell, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";

// Supervision (brief §9): the month's visits (Store Checks and OTP Verifications) with the
// Findings each raised, and the Supervision Planner — supervision_plan() (migration 0105):
// each supervisor's facilities ranked by risk, the due ones suggested up to their monthly
// workload. Exportable as CSV for their task list.

export default async function SupervisionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  // The Planner needs supervisors' LGA assignments, which RLS shows only to admins and to each
  // supervisor (their own) — other roles get the visit list.
  const canPlan = ["super_admin", "project_admin", "tpm_supervisor"].includes(profile.role);
  const tab = sp.tab === "planner" && canPlan ? "planner" : "visits";
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const lgas = await getLgas(supabase);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));

  const tabs = (
    <div className="seg" style={{ width: "fit-content" }}>
      {(canPlan ? (["visits", "planner"] as const) : (["visits"] as const)).map((t) => (
        <Link key={t} href={`/supervision?tab=${t}&month=${month.key}`} className="seg-opt"
          style={{ textDecoration: "none", color: "inherit", ...(tab === t ? { color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-accent)" } : {}) }}>
          {t === "visits" ? "Visits" : "Supervision Planner"}
        </Link>
      ))}
    </div>
  );

  if (tab === "planner") {
    const { data: plan, error } = await supabase.rpc("supervision_plan", { p_as_of: month.end });
    const rows = (plan ?? []).filter((r) => !sp.lga || r.lga_id === sp.lga);
    const bySupervisor = new Map<string, typeof rows>();
    for (const r of rows) bySupervisor.set(r.supervisor_id, [...(bySupervisor.get(r.supervisor_id) ?? []), r]);
    const suggested = rows.filter((r) => r.suggested);
    return (
      <ReportShell title="Supervision" monthKey={month.key} lgas={lgas} sp={{ ...sp, tab: "planner" }} showLevel={false}
        intro={<>Each supervisor&apos;s facilities ranked by risk as of {month.end}. Due: never visited, not visited in 90 days, or high-risk and not visited in 30 days. The top due facilities, up to the monthly workload, are suggested.</>}
        extraFilters={<input type="hidden" name="tab" defaultValue="planner" />}>
        {tabs}
        {error && <p style={{ color: "var(--priority-critical)" }}>The plan couldn&apos;t be loaded.</p>}
        <SummaryTiles items={[
          { label: "Supervisors", value: fmt(bySupervisor.size) },
          { label: "Facilities due", value: fmt(rows.filter((r) => r.due).length) },
          { label: "Suggested for next month", value: fmt(suggested.length) },
        ]} />
        <div>
          <a className="btn btn-secondary" href={`/supervision/plan.csv?month=${month.key}${sp.lga ? `&lga=${sp.lga}` : ""}`}>
            <i className="ph ph-download-simple" /> Export suggested visits (CSV)
          </a>
        </div>
        {[...bySupervisor.values()].map((list) => (
          <div key={list[0].supervisor_id} className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid var(--color-divider)" }}>
              {list[0].supervisor_name} <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>· {list.filter((r) => r.suggested).length} suggested of {list.length} facilities</span>
            </div>
            <table className="table">
              <thead><tr><th>#</th><th>Facility</th><th>Level</th><th>LGA</th><th style={{ textAlign: "right" }}>Risk</th><th>Last visit</th><th>Why due</th><th></th></tr></thead>
              <tbody>
                {list.slice(0, 15).map((r) => (
                  <tr key={r.facility_id}>
                    <td className="text-muted">{r.rank}</td>
                    <td><Link href={`/stock-ledger?facility=${r.facility_id}`}>{r.facility_name}</Link></td>
                    <td className="text-muted">{LEVEL_LABEL[r.facility_type]}</td>
                    <td>{lgaName[r.lga_id] ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.risk_score >= 50 ? <Flag level="warning">{r.risk_score}</Flag> : r.risk_score}</td>
                    <td>{r.last_visit_date ? `${r.last_visit_date} (${r.days_since_visit} d)` : "Never"}</td>
                    <td>{r.reason ?? <span className="text-muted">Not due</span>}</td>
                    <td>{r.suggested && <span className="tag tag-accent">Suggested</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 15 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 16px" }}>+ {list.length - 15} more not due.</div>}
          </div>
        ))}
      </ReportShell>
    );
  }

  const { data: visits } = await supabase
    .from("monitoring_visits")
    .select("id, code, visit_type, visit_date, facility_id, supervisor_id, distance_to_facility_m, outside_geofence, facility:facilities(name, lga_id)")
    .gte("visit_date", month.start).lte("visit_date", month.end).order("visit_date", { ascending: false }).limit(1000);
  const list = (visits ?? []).filter((v) => !sp.lga || (v.facility as unknown as { lga_id: string } | null)?.lga_id === sp.lga);
  const ids = list.map((v) => v.id);
  const { data: findings } = ids.length ? await supabase.from("issues").select("visit_id").in("visit_id", ids) : { data: [] };
  const raised: Record<string, number> = {};
  for (const f of findings ?? []) if (f.visit_id) raised[f.visit_id] = (raised[f.visit_id] ?? 0) + 1;
  const { data: people } = await supabase.from("profiles").select("id, name").in("id", [...new Set(list.map((v) => v.supervisor_id))]);
  const who = Object.fromEntries((people ?? []).map((p) => [p.id, p.name]));

  return (
    <ReportShell title="Supervision" monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
      intro={<>Store Checks and OTP Verifications recorded in {month.label}, with the Findings each visit raised. A visit more than 150 m from the facility&apos;s recorded point is flagged.</>}>
      {tabs}
      <SummaryTiles items={[
        { label: "Visits", value: fmt(list.length) },
        { label: "Store checks", value: fmt(list.filter((v) => v.visit_type === "store_check").length) },
        { label: "OTP verifications", value: fmt(list.filter((v) => v.visit_type === "otp_verification").length) },
        { label: "Outside the geofence", value: fmt(list.filter((v) => v.outside_geofence).length) },
        { label: "Findings raised", value: fmt(Object.values(raised).reduce((a, b) => a + b, 0)) },
      ]} />
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>Visit</th><th>Type</th><th>Facility</th><th>Date</th><th>Supervisor</th><th style={{ textAlign: "right" }}>Distance</th><th style={{ textAlign: "right" }}>Findings</th></tr></thead>
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
                  <td style={{ textAlign: "right" }}>{v.distance_to_facility_m === null ? "—" : v.outside_geofence ? <Flag level="warning">{fmt(v.distance_to_facility_m)} m</Flag> : `${fmt(v.distance_to_facility_m)} m`}</td>
                  <td style={{ textAlign: "right" }}>{raised[v.id] ? <Link href={`/issues?search=${v.code}`}>{raised[v.id]}</Link> : 0}</td>
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
