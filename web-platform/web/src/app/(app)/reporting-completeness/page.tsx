import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth } from "@/lib/queries/metrics";
import { Meter } from "@/components/dashboard/Kpi";
import { FacilityLink, Flag, LEVEL_LABEL, ReportShell, fmt, type SP } from "@/components/reports/ReportShell";

// Reporting Completeness (brief §9): which OTP sites recorded daily dispensing every week, and
// which stores and OTP sites counted at month end on time. Same definitions as rutf_kpis()
// (DECISIONS R38). Facilities with gaps first.

export default async function ReportingCompletenessPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [rows, lgas] = await Promise.all([getFacilityMetrics(supabase, month, { level: sp.level, lga: sp.lga }), getLgas(supabase)]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));

  const otps = rows.filter((r) => r.is_otp_site);
  const weeksSeen = otps.reduce((n, r) => n + (r.dispensing_weeks ?? 0), 0);
  const weeksExpected = otps.reduce((n, r) => n + (r.expected_weeks ?? 0), 0);
  const onTime = rows.filter((r) => r.count_on_time).length;
  const gap = (r: (typeof rows)[number]) => (r.expected_weeks ? r.expected_weeks - (r.dispensing_weeks ?? 0) : 0) + (r.count_on_time ? 0 : 1);
  const sorted = [...rows].sort((a, b) => gap(b) - gap(a) || a.facility_name.localeCompare(b.facility_name));
  const missing = sorted.filter((r) => gap(r) > 0);
  const show = sp.all === "1" ? sorted : missing;

  return (
    <ReportShell
      title="Reporting Completeness"
      intro={<>Daily dispensing is counted in full weeks of the month ({otps[0]?.expected_weeks ?? 4} for {month.label}); the month-end count is on time when dated in the last days of the month or by the due day of the next.</>}
      monthKey={month.key} lgas={lgas} sp={sp}
      extraFilters={
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Show complete facilities too
        </label>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        <Meter label="Daily dispensing reported" pct={weeksExpected ? (weeksSeen * 100) / weeksExpected : null}
          sub={`${fmt(weeksSeen)} of ${fmt(weeksExpected)} OTP-weeks`} warnBelow={90} criticalBelow={75} />
        <Meter label="Month-end counts on time" pct={rows.length ? (onTime * 100) / rows.length : null}
          sub={`${fmt(onTime)} of ${fmt(rows.length)} stores and OTP sites`} warnBelow={90} criticalBelow={75} />
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Facility</th><th>Level</th><th>LGA</th><th style={{ textAlign: "right" }}>Dispensing weeks</th><th>Month-end count</th></tr>
          </thead>
          <tbody>
            {show.map((r) => (
              <tr key={r.facility_id}>
                <td><FacilityLink id={r.facility_id} name={r.facility_name} /></td>
                <td className="text-muted">{LEVEL_LABEL[r.facility_type]}</td>
                <td>{lgaName[r.lga_id] ?? "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {r.expected_weeks === null ? "—" : (r.dispensing_weeks ?? 0) < r.expected_weeks
                    ? <Flag level="warning">{r.dispensing_weeks ?? 0} of {r.expected_weeks}</Flag> : `${r.dispensing_weeks} of ${r.expected_weeks}`}
                </td>
                <td>{r.count_on_time ? "On time" : <Flag level="warning">Missing or late</Flag>}</td>
              </tr>
            ))}
            {show.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>Every facility reported in full.</td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
