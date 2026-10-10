import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { ApproveRules } from "@/components/reports/ApproveRules";

export const metadata: Metadata = { title: "Clinical Rules" };

// Clinical Rules (DECISIONS R162): the rule set the OTP Admission Card applies — admission and
// discharge thresholds, follow-up, the RUTF ration table, MNP — from the approved booklet and the
// programme's decisions, with the questions still open. Everyone signed in can read it; only the
// State Nutrition Officer, who sets the rules the OTP Officers follow, can approve a draft
// (otp_rule_set_approve). No personal data.

type Rules = {
  version: string; status: string; source: string; params: Record<string, unknown>; effective_from: string | null;
  approved_by: string | null; approved_at: string | null; approval_note: string | null; can_approve: boolean;
  bands: { min_kg: number; max_kg: number | null; per_day: number; per_week: number; source: string }[];
};

// The rule-set settings, in words, in the order an officer meets them.
const PARAMS: [string, string, (v: unknown) => string][] = [
  ["min_age_months", "Youngest child for OTP", (v) => `${v} months (younger: stabilisation care)`],
  ["max_age_months", "Oldest child for OTP", (v) => `${v} months`],
  ["muac_sam_below", "SAM: MUAC below", (v) => `${v} cm (red)`],
  ["muac_normal_above", "Normal: MUAC above", (v) => `${v} cm (green); in between is yellow (MAM)`],
  ["wfh_sam_below", "SAM: weight-for-height below", (v) => `${v} Z (sites using WFH)`],
  ["wfh_normal_above", "Normal: weight-for-height above", (v) => `${v} Z`],
  ["stabilisation_weight_below", "Stabilisation care: weight below", (v) => `${v} kg (Q2: may be 4 kg)`],
  ["visit_interval_days", "Follow-up", (v) => `every ${v} days (weekly)`],
  ["max_weeks", "Follow-up up to", (v) => `${v} weeks until the child recovers; then refer to a doctor`],
  ["discharge_min_weeks_muac", "Discharge (MUAC admission): minimum stay", (v) => `${v} weeks`],
  ["discharge_muac_above", "Discharge: MUAC above", (v) => `${v} cm`],
  ["discharge_wfh_above", "Discharge: weight-for-height above", (v) => `${v} Z`],
  ["discharge_consecutive_visits", "Discharge: criteria met at", (v) => `${v} consecutive visits (oedema, WFH)`],
  ["defaulter_consecutive_absences", "Defaulter after", (v) => `${v} consecutive absences`],
  ["no_weight_change_visit", "No weight change flagged at visit", (v) => `${v} (card footnote)`],
  ["deworming_visit", "Deworming at visit", (v) => `${v}`],
  ["rutf_photo_required", "Photo of the RUTF given", (v) => (v ? "required whenever RUTF is given (sachets only)" : "optional")],
];

// The questions still open for the clinical authority (docs/otp-digitisation/RULEBOOK.md §10).
const QUESTIONS: Record<string, string> = {
  Q1: "MUAC of exactly 11.5 or 12.5 cm: which class?",
  Q2: "The 3.5–3.9 kg ration row is struck through: is stabilisation now below 4 kg?",
  Q3: "Marasmic kwashiorkor = wasting and oedema → stabilisation?",
  Q4: "Measurement precision, plausible ranges, a weight between ration bands",
  Q5: "Which sites use weight-for-height; may the WHO tables be used?",
  Q6: "Which medical complications send a child to stabilisation care?",
  Q7: "The appetite test: amount, time, pass and fail",
  Q8: "How the card's Readmission and Relapse map to the admission types",
  Q9: "Defaulter: 3 absences from what schedule?",
  Q10: "Medication doses: record only, or calculate from an approved table?",
  Q11: "Vitamin A is struck through: removed?",
  Q13: "Use the table's weekly packets as printed?",
  Q14: "How \"no change in weight\" and \"sustained weight gain\" are measured",
  Q15: "Discharge MUAC: above 11.5 or above 12.5 cm?",
  Q16: "The 8-week minimum stay applies to MUAC admissions only?",
  Q17: "Which findings define \"clinically well\"",
  Q18: "When a child is non-recovered or non-responding",
  Q19: "Buffer stock for RUTF requests",
  Q20: "The Apex OTP centre in each LGA",
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function ClinicalRulesPage() {
  await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("otp_rules_view");
  const r = data as unknown as Rules | null;
  const open = ((r?.params?.open_questions as string[] | undefined) ?? []).filter((q) => QUESTIONS[q]);
  const approved = r?.status === "approved";

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Clinical Rules</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
          The rules the OTP Admission Card applies when an OTP Officer screens, admits, follows up and discharges a child: thresholds from the
          approved booklet and the programme&apos;s decisions. The <b>State Nutrition Officer</b> sets the rules the OTP Officers follow and approves them here;
          until then they are a draft. Where the booklet is unclear, the app does not guess: the case goes for clinical review.
        </p>
      </div>
      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the rules: {error.message}</div>}
      {r && (
        <>
          <div className="card elev-sm" style={{ gap: 6, borderLeft: `4px solid ${approved ? "var(--status-resolved)" : "var(--priority-high)"}` }}>
            <div className="card-title">
              <i className={`ph-fill ${approved ? "ph-seal-check" : "ph-hourglass-medium"}`} style={{ color: approved ? "var(--status-resolved)" : "var(--priority-high)" }} aria-hidden="true" />{" "}
              Version {r.version} · {approved ? "Approved" : "Draft, awaiting the State Nutrition Officer"}
            </div>
            {approved ? (
              <div style={{ fontSize: 13 }}>Approved by {r.approved_by}{r.approved_at ? ` on ${new Date(r.approved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}` : ""}
                {r.effective_from ? `; in force from ${fmtDay(r.effective_from)} for new admissions` : ""}.{r.approval_note ? ` “${r.approval_note}”` : ""}</div>
            ) : (
              <div className="kpi-sub">{open.length} question{open.length === 1 ? "" : "s"} still open (below). The State Nutrition Officer may approve the rules with them open: those cases keep going for clinical review.</div>
            )}
            <div className="kpi-sub">Source: {r.source}</div>
          </div>

          {r.can_approve && <ApproveRules version={r.version} openQuestions={open.length} />}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
            <div className="card elev-sm" style={{ gap: 8 }}>
              <div className="card-title">Admission, follow-up and discharge</div>
              <table className="table"><tbody>
                {PARAMS.filter(([k]) => r.params[k] !== undefined && r.params[k] !== null).map(([k, label, show]) => (
                  <tr key={k}><td>{label}</td><td style={{ textAlign: "right" }}>{show(r.params[k])}</td></tr>
                ))}
              </tbody></table>
            </div>
            <div className="card elev-sm" style={{ gap: 8 }}>
              <div className="card-title">RUTF ration (92 g packets)</div>
              <table className="table">
                <thead><tr><th>Weight (kg)</th><th style={{ textAlign: "right" }}>A day</th><th style={{ textAlign: "right" }}>A week</th></tr></thead>
                <tbody>
                  {r.bands.map((b) => (
                    <tr key={b.min_kg}><td>{b.min_kg}{b.max_kg ? ` – ${b.max_kg}` : " and over"}</td><td style={{ textAlign: "right" }}>{b.per_day}</td><td style={{ textAlign: "right" }}><b>{b.per_week}</b></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="kpi-sub">No RUTF is recommended with severe oedema (+++), a poor appetite test, or while a referral is open; the OTP Officer may still give it with a reason.</div>
            </div>
            <div className="card elev-sm" style={{ gap: 8 }}>
              <div className="card-title">MNP (moderate malnutrition)</div>
              <table className="table"><tbody>
                <tr><td>Who</td><td style={{ textAlign: "right" }}>MUAC yellow, no complications</td></tr>
                <tr><td>Given</td><td style={{ textAlign: "right" }}>3 boxes (90 sachets) at once, for 3 months</td></tr>
                <tr><td>Follow-up</td><td style={{ textAlign: "right" }}>after 3 months</td></tr>
                <tr><td>Pack</td><td style={{ textAlign: "right" }}>150 sachets a carton, 5 boxes of 30</td></tr>
              </tbody></table>
            </div>
            <div className="card elev-sm" style={{ gap: 8 }}>
              <div className="card-title">Questions still open</div>
              {open.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>None.</div> : (
                <table className="table"><tbody>
                  {open.map((q) => <tr key={q}><td style={{ width: 48 }}><b>{q}</b></td><td style={{ fontSize: 13 }}>{QUESTIONS[q]}</td></tr>)}
                </tbody></table>
              )}
              <div className="kpi-sub">Details and sources: docs/otp-digitisation/RULEBOOK.md.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
