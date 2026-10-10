import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { monthOf } from "@/lib/queries/kpis";
import { ReportShell, fmt, type SP } from "@/components/reports/ReportShell";

export const metadata: Metadata = { title: "OTP Caseload" };

// OTP Caseload (DECISIONS R143): the children under OTP treatment, from the Digital OTP Admission
// Card (migration 0124), as AGGREGATES ONLY — the monthly figures the RUTF allocation guidance asks
// each OTP centre and LGA for (opening caseload, admissions, exits by outcome, closing caseload,
// RUTF), admissions by sex and age group, and screening outcomes. No child is named or listed:
// a child's record is opened only by an OTP Officer, in the app, by entering the Child ID.
// otp_aggregates() hides counts from 1 to (min cell − 1).

type Cohort = {
  opening: number; admissions: number; new_cases: number; cured: number; defaulted: number; died: number;
  non_recovered: number; transferred_or_other: number; closing: number;
};
type Aggregates = {
  min_cell_count: number;
  cohort: Cohort;
  admissions_by_sex_age: Record<string, number | null>;
  suppressed: boolean;
  rutf_packets: { prescribed: number; dispensed: number; visits_differing: number };
  screenings_by_pathway: Record<string, number | null>;
};

const PATHWAY: Record<string, string> = {
  otp: "Admitted to OTP",
  stabilisation: "Referred to stabilisation care",
  inpatient_paediatric: "Referred to inpatient paediatric care",
  nutrition_advice: "Moderate: nutrition advice or SFP",
  praise_advice: "Normal: praised and advised",
  clinical_review: "Referred for clinical review",
  incomplete: "Screening not completed",
  correct_inputs: "Measurements to correct",
};
const AGES = ["6-11", "12-23", "24-59"] as const;

export default async function OtpCaseloadPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  // The caseload runs in real time, so the current month is the default (not the ledger's month).
  const month = monthOf(/^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7));
  const [lgas, agg, rules] = await Promise.all([
    getProgrammeLgas(supabase),
    supabase.rpc("otp_aggregates", { p_start: month.start, p_end: month.end, p_lga_id: sp.lga || null }),
    supabase.rpc("otp_ration", { p_weight_kg: null }),
  ]);
  const a = agg.data as unknown as Aggregates | null;
  const r = rules.data as unknown as { rule_set?: string; rule_status?: string } | null;
  const lgaName = sp.lga ? lgas.find((l) => l.id === sp.lga)?.name : null;
  const c = a?.cohort;
  const exits = c ? c.cured + c.defaulted + c.died + c.non_recovered + c.transferred_or_other : 0;
  const balances = c ? c.opening + c.admissions - exits === c.closing : true;
  const cell = (n: number | null | undefined) => (n === null ? `<${a?.min_cell_count ?? 5}` : fmt(n ?? 0));

  const tiles = c ? [
    { label: "Under treatment at the start", value: fmt(c.opening), sub: `1 ${month.label.split(" ")[0]}` },
    { label: "Admissions", value: fmt(c.admissions), sub: `${fmt(c.new_cases)} new cases` },
    { label: "Discharged cured", value: fmt(c.cured), sub: "All criteria met, confirmed" },
    { label: "Defaulted", value: fmt(c.defaulted), sub: "3 consecutive absences" },
    { label: "Died", value: fmt(c.died), sub: "Recorded with a reason" },
    { label: "Non-recovered", value: fmt(c.non_recovered), sub: "Recorded with a reason" },
    { label: "Transferred or other", value: fmt(c.transferred_or_other), sub: "Inpatient, refused, other OTP site" },
    { label: "Under treatment at the end", value: fmt(c.closing), sub: balances ? "Start + admissions − exits ✓" : "Does not balance: check the records" },
  ] : [];

  return (
    <ReportShell
      title="OTP Caseload"
      intro={<>The children under treatment in the Outpatient Therapeutic Programme{lgaName ? ` in ${lgaName}` : ""} for {month.label}, from the Digital OTP Admission Card: the figures each OTP centre reports to its LGA and the LGA to the State for the RUTF request. <b>Totals only.</b> A child&apos;s and caregiver&apos;s details are never shown here: only the OTP Officer at the child&apos;s OTP site can open a record, in the app, by entering the Child ID. Counts from 1 to {(a?.min_cell_count ?? 5) - 1} are hidden so no child can be singled out.</>}
      monthKey={month.key} lgas={lgas} sp={sp} showLevel={false}
    >
      {agg.error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the OTP figures: {agg.error.message}</div>}

      {r?.rule_set && (
        <div className="kpi-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <i className={`ph-fill ${r.rule_status === "approved" ? "ph-seal-check" : "ph-hourglass-medium"}`} aria-hidden="true"
            style={{ color: r.rule_status === "approved" ? "var(--status-resolved)" : "var(--priority-high)" }} />
          Clinical rules: version {r.rule_set}{r.rule_status === "approved" ? ", approved" : ", draft awaiting sign-off by the clinical authority (docs/otp-digitisation/RULEBOOK.md)"}
        </div>
      )}

      {c && (
        <div className="kpi-row">
          {tiles.map((t) => (
            <div key={t.label} className="card elev-sm kpi-card">
              <div className="kpi-label">{t.label}</div>
              <div className="kpi-value">{t.value}</div>
              <div className="kpi-sub">{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">Admissions by sex and age</div>
          <div className="kpi-sub">{month.label} · age at registration, in months</div>
          <table className="table">
            <thead><tr><th>Sex</th>{AGES.map((g) => <th key={g} style={{ textAlign: "right" }}>{g} months</th>)}</tr></thead>
            <tbody>
              {(["F", "M"] as const).map((s) => (
                <tr key={s}>
                  <td>{s === "F" ? "Girls" : "Boys"}</td>
                  {/* A group with no children is absent (0); a hidden one is present as null ("<5"). */}
                  {AGES.map((g) => {
                    const cells = a?.admissions_by_sex_age ?? {};
                    const key = `${s}:${g}`;
                    return <td key={g} style={{ textAlign: "right" }}>{key in cells ? cell(cells[key]) : "0"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {a?.suppressed && <div className="kpi-sub">&ldquo;&lt;{a.min_cell_count}&rdquo;: a small count, hidden to protect children&apos;s privacy. When only one count would be hidden, another is hidden too, so it can&apos;t be worked out from the total.</div>}
        </div>

        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">Screening outcomes</div>
          <div className="kpi-sub">Every child screened at an OTP site in {month.label}, admitted or not</div>
          <table className="table">
            <tbody>
              {Object.keys(PATHWAY).filter((k) => a?.screenings_by_pathway && k in a.screenings_by_pathway).map((k) => (
                <tr key={k}><td>{PATHWAY[k]}</td><td style={{ textAlign: "right" }}>{cell(a?.screenings_by_pathway[k])}</td></tr>
              ))}
              {!a || Object.keys(a.screenings_by_pathway ?? {}).length === 0 ? (
                <tr><td className="text-muted" colSpan={2}>No screenings recorded in {month.label}.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">RUTF to children</div>
          <div className="kpi-sub">92 g packets at visits in {month.label}, from the ration table by each child&apos;s weight</div>
          <table className="table">
            <tbody>
              <tr><td>Prescribed</td><td style={{ textAlign: "right" }}>{fmt(a?.rutf_packets.prescribed ?? 0)}</td></tr>
              <tr><td>Dispensed</td><td style={{ textAlign: "right" }}>{fmt(a?.rutf_packets.dispensed ?? 0)}</td></tr>
              <tr><td>Visits where dispensed differed (reason recorded)</td><td style={{ textAlign: "right" }}>{fmt(a?.rutf_packets.visits_differing ?? 0)}</td></tr>
            </tbody>
          </table>
          <div className="kpi-sub">Children under treatment at the end of the month, with their ration, are the basis of next month&apos;s RUTF request (allocation guidance §1, §6).</div>
        </div>
      </div>
    </ReportShell>
  );
}
