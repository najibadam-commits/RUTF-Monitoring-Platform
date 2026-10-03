import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { reportMonth } from "@/lib/queries/metrics";
import { FacilityLink, Flag, ReportShell, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";
import { Dhis2Upload } from "@/components/dhis2/Dhis2Upload";

export const metadata: Metadata = { title: "DHIS2 Triangulation" };

// DHIS2 Triangulation (brief §9): each facility's DHIS2 monthly report against the ledger for the
// same month — received, distributed (dispensed + issued), wasted (losses) and stockout days.
// dhis2_triangulation() (migration 0105). Largest distribution gaps first.

const LIMIT = 10;

function pair(dhis2: number | null, ledger: number) {
  return (
    <>
      {dhis2 === null ? "—" : fmt(dhis2)} <span className="text-muted">/ {fmt(ledger)}</span>
    </>
  );
}

export default async function Dhis2TriangulationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [{ data, error }, lgas] = await Promise.all([
    supabase.rpc("dhis2_triangulation", { p_start: month.start, p_end: month.end }),
    getLgas(supabase),
  ]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const gap = (r: { distributed_diff_pct: number | null }) => Math.abs(Number(r.distributed_diff_pct ?? 0));
  const rows = (data ?? []).filter((r) => !sp.lga || r.lga_id === sp.lga).sort((a, b) => gap(b) - gap(a));
  const off = rows.filter((r) => gap(r) > LIMIT);
  const show = sp.all === "1" ? rows : off;
  const sum = (k: "dhis2_distributed" | "ledger_distributed") => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const isAdmin = ["super_admin", "project_admin"].includes(profile.role);

  return (
    <ReportShell
      title="DHIS2 Triangulation"
      intro={<>Each facility&apos;s DHIS2 monthly report for {month.label} beside the ledger, shown as DHIS2 / ledger. Distributed = dispensed + issued; wasted = recorded losses. A facility is flagged when DHIS2 distribution differs from the ledger by more than {LIMIT}%.</>}
      monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
      extraFilters={
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Show matching facilities too
        </label>
      }
    >
      {isAdmin && <Dhis2Upload />}
      {error && <p style={{ color: "var(--priority-critical)" }}>The comparison couldn&apos;t be loaded.</p>}
      <SummaryTiles items={[
        { label: "Facilities reporting to DHIS2", value: fmt(rows.length) },
        { label: `Over ${LIMIT}% apart`, value: fmt(off.length), sub: rows.length ? `${fmt((off.length * 100) / rows.length, 1)}% of reports` : undefined },
        { label: "Distributed per DHIS2", value: fmt(sum("dhis2_distributed")), sub: "sachets" },
        { label: "Distributed per ledger", value: fmt(sum("ledger_distributed")), sub: "sachets" },
      ]} />
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Facility</th><th>LGA</th><th style={{ textAlign: "right" }}>Received</th><th style={{ textAlign: "right" }}>Distributed</th>
              <th style={{ textAlign: "right" }}>Difference</th><th style={{ textAlign: "right" }}>Wasted</th><th style={{ textAlign: "right" }}>Stockout days</th>
            </tr>
          </thead>
          <tbody>
            {show.map((r) => {
              const d = r.distributed_diff_pct === null ? null : Number(r.distributed_diff_pct);
              const label = d === null ? "—" : `${d > 0 ? "+" : ""}${fmt(d, 1)}%`;
              return (
                <tr key={`${r.facility_id}-${r.period}`}>
                  <td><FacilityLink id={r.facility_id} name={r.facility_name} /></td>
                  <td>{lgaName[r.lga_id] ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_received, r.ledger_received)}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_distributed, r.ledger_distributed)}</td>
                  <td style={{ textAlign: "right" }}>{d !== null && Math.abs(d) > LIMIT ? <Flag level="warning">{label}</Flag> : label}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_wasted, r.ledger_wasted)}</td>
                  <td style={{ textAlign: "right" }}>{pair(r.dhis2_stockout_days, r.ledger_stockout_days)}</td>
                </tr>
              );
            })}
            {show.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  {rows.length === 0 ? `No DHIS2 reports loaded for ${month.label}.` : "Every DHIS2 report is within the limit."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
