import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getLgas } from "@/lib/queries/lookups";
import { getFacilityMetrics, reportMonth } from "@/lib/queries/metrics";
import { FacilityLink, Flag, ReportShell, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";

// OTP Dispensing (brief §9): dispensed against prescribed (short-dispensing), children seen and
// admissions from the daily register tallies, and the verification factor from the latest
// supervision visit. Aggregate figures only — no child-level data (brief §10).

export default async function OtpDispensingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const month = await reportMonth(supabase, sp.month);
  const [rows, lgas, { data: th }] = await Promise.all([
    getFacilityMetrics(supabase, month, { level: "health_facility", lga: sp.lga }),
    getLgas(supabase),
    supabase.from("rutf_thresholds").select("key, value").in("key", ["short_dispense_pct", "vf_min", "vf_max"]),
  ]);
  const t = Object.fromEntries((th ?? []).map((r) => [r.key, Number(r.value)]));
  const shortLimit = t.short_dispense_pct ?? 5;
  const [vfMin, vfMax] = [t.vf_min ?? 0.9, t.vf_max ?? 1.1];
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const sorted = [...rows].sort((a, b) => Number(b.short_pct ?? -999) - Number(a.short_pct ?? -999));

  const p = rows.reduce((n, r) => n + r.sachets_prescribed, 0);
  const d = rows.reduce((n, r) => n + r.sachets_dispensed, 0);
  const vfOut = rows.filter((r) => r.last_vf !== null && (Number(r.last_vf) < vfMin || Number(r.last_vf) > vfMax)).length;

  return (
    <ReportShell
      title="Last-Mile Dispensing"
      intro={<>From the OTP registers&apos; daily totals, {month.label}. Short-dispensing limit {shortLimit}%; a negative figure means more was dispensed than prescribed. VF = supervisor&apos;s register count ÷ app-recorded dispensing at the latest visit (range {vfMin.toFixed(2)}–{vfMax.toFixed(2)}).</>}
      monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
    >
      <SummaryTiles items={[
        { label: "Sachets prescribed", value: fmt(p) },
        { label: "Sachets dispensed", value: fmt(d), sub: p ? `${fmt(((p - d) * 100) / p, 1)}% short overall` : undefined },
        { label: `OTP sites over ${shortLimit}% short`, value: fmt(rows.filter((r) => Number(r.short_pct ?? 0) > shortLimit).length), sub: `of ${fmt(rows.length)}` },
        { label: "Latest VF out of range", value: fmt(vfOut), sub: "OTP sites" },
      ]} />
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>OTP site</th><th>LGA</th><th style={{ textAlign: "right" }}>Children seen</th><th style={{ textAlign: "right" }}>New admissions</th>
              <th style={{ textAlign: "right" }}>Prescribed</th><th style={{ textAlign: "right" }}>Dispensed</th>
              <th style={{ textAlign: "right" }}>Short</th><th style={{ textAlign: "right" }}>Latest VF</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.facility_id}>
                <td><FacilityLink id={r.facility_id} name={r.facility_name} /></td>
                <td>{lgaName[r.lga_id] ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.children_seen)}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.new_admissions)}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.sachets_prescribed)}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.sachets_dispensed)}</td>
                <td style={{ textAlign: "right" }}>
                  {r.short_pct === null ? "—" : Number(r.short_pct) > shortLimit ? <Flag level="warning">{fmt(r.short_pct, 1)}%</Flag> : `${fmt(r.short_pct, 1)}%`}
                </td>
                <td style={{ textAlign: "right" }}>
                  {r.last_vf === null ? "—" : Number(r.last_vf) < vfMin || Number(r.last_vf) > vfMax ? <Flag level="warning">{Number(r.last_vf).toFixed(2)}</Flag> : Number(r.last_vf).toFixed(2)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No OTP sites for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
