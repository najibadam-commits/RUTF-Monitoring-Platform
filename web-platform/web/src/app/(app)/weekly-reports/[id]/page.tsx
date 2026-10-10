import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessWeeklyReports } from "@/lib/rbac";
import { WeeklyReportDecision } from "@/components/reports/WeeklyReportDecision";

export const metadata: Metadata = { title: "Weekly OTP Report" };

// One weekly OTP report (DECISIONS R148, R153): the submitted version's sections A–L exactly as
// calculated and submitted (with any figure the officer corrected, its calculated value and the
// reason), the data-quality issues with the officer's explanations, every version with its
// decision, and — for the State Coordinator — approve, return or reject. Opening a submitted
// report marks it "under review". Aggregate only.

type BySex = { M: number; F: number; total: number };
type Issue = { code: string; severity: "blocking" | "warning" | "info"; section: string; message: string };
// The engine's JSON (otp_weekly_report_compute), read field by field with optional chaining.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EngineJson = Record<string, any>;
type Adjustment = { path: string; calculated: number | null; original_when_corrected: number | null; adjusted: number; reason: string; by: string; at: string };
type Version = {
  version: number; data: EngineJson; issues: Issue[]; comments: Record<string, string>; adjustments: Adjustment[]; amendment: boolean; amendment_reason: string | null;
  submitted_by: string; submitted_at: string; review_started_by: string | null; review_started_at: string | null;
  decision: string | null; decision_note: string | null; decided_by: string | null; decided_at: string | null;
};
type Report = {
  report_id: string; status: string; amendment: boolean; week_start: string; week_end: string; facility: string; lga: string;
  can_decide: boolean; can_start_review: boolean; versions: Version[];
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const n = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));
const STATUS_LABEL: Record<string, string> = {
  submitted: "Waiting for review", under_review: "Under review", approved: "Approved", returned: "Returned for correction", rejected: "Rejected", draft: "Draft",
};
const DECISION_LABEL: Record<string, string> = { approved: "Approved", returned: "Returned", rejected: "Rejected" };
// Where a corrected figure sits in the report, in words.
const FIGURE_LABEL: Record<string, string> = {
  "B.SAM.total": "B. Under treatment at the start", "C.SAM.total": "C. New cases", "D.SAM.in.total": "D. Transfers in", "D.SAM.out.total": "D. Transfers out",
  "E.SAM.cured.total": "E. Cured", "E.SAM.defaulted.total": "E. Defaulted", "E.SAM.died.total": "E. Died", "E.SAM.non_recovered.total": "E. Non-recovered",
  "E.SAM.absent.total": "E. Absent", "F.SAM.actual.total": "F. Under treatment at the end", "G.received": "G. RUTF received", "G.dispensed": "G. RUTF dispensed",
  "G.losses": "G. RUTF losses", "I.total.total": "I. Children screened", "J.sessions": "J. Sessions", "J.total_participants": "J. Participants",
  "L.visits.admission": "L. Admission visits", "L.visits.second": "L. Second visits", "L.visits.third": "L. Third visits",
  "L.visits.fourth_or_later": "L. Fourth or later visits", "L.visits.absent": "L. Absences", "L.rutf.given": "L. RUTF packets given", "L.referrals.made": "L. Referrals made",
};
const OUTCOMES: [string, string][] = [
  ["cured", "Cured"], ["non_recovered", "Non-recovered"], ["died", "Death"], ["defaulted", "Defaulter"],
  ["transferred_inpatient", "Transferred to inpatient care"], ["refused_inpatient", "Refused inpatient care"], ["absent", "Absentees (still under treatment)"],
];

function Section({ letter, title, children, note }: { letter: string; title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="card elev-sm" style={{ gap: 8 }}>
      <div className="card-title"><span className="text-muted">{letter}.</span> {title}</div>
      {children}
      {note && <div className="kpi-sub">{note}</div>}
    </div>
  );
}
function SexTable({ rows }: { rows: [string, BySex | null | undefined, string?][] }) {
  return (
    <table className="table">
      <thead><tr><th></th><th style={{ textAlign: "right" }}>Male</th><th style={{ textAlign: "right" }}>Female</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
      <tbody>
        {rows.map(([label, v, na]) => (
          <tr key={label}><td>{label}</td>
            {na ? <td colSpan={3} className="text-muted" style={{ textAlign: "right" }}>{na}</td>
              : <><td style={{ textAlign: "right" }}>{n(v?.M)}</td><td style={{ textAlign: "right" }}>{n(v?.F)}</td><td style={{ textAlign: "right" }}><b>{n(v?.total)}</b></td></>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function WeeklyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!canAccessWeeklyReports(profile.role)) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("otp_report_get", { p_report_id: id });
  if (error || !data) notFound();
  const r = data as unknown as Report;
  const v = r.versions[0];
  if (!v) notFound();
  const s = v.data;
  const NA = "Not applicable: no HR MAM admission rule in the guidelines";
  const g = s.G ?? {};
  const cartons = (sachets: unknown) => (g.sachets_per_carton && sachets !== null && sachets !== undefined ? (Number(sachets) / g.sachets_per_carton).toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—");
  const F = s.F?.SAM ?? {};
  const reconciled = F.calculated?.total === F.actual?.total && F.calculated?.M === F.actual?.M && F.calculated?.F === F.actual?.F;
  const unexplained = v.issues.filter((i) => i.severity === "blocking" && !(v.comments?.[i.code] ?? "").trim()).length;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link href="/weekly-reports" style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> Weekly OTP Reports</Link>
        <h2 style={{ margin: "6px 0 2px" }}>{r.facility} · week of {fmtDay(r.week_start)}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {r.lga} LGA · {fmtDay(r.week_start)} – {fmtDay(r.week_end)} · <b>{STATUS_LABEL[r.status] ?? r.status}</b> · version {v.version}
          {v.amendment ? " (amendment)" : ""} submitted by {v.submitted_by} on {fmtTime(v.submitted_at)}
          {v.review_started_at ? ` · review started by ${v.review_started_by} on ${fmtTime(v.review_started_at)}` : ""}
        </p>
      </div>

      {r.can_decide && <WeeklyReportDecision reportId={r.report_id} unexplainedBlocking={unexplained} startReview={r.can_start_review} />}

      {/* K first: the issues and the officer's explanations, which the decision turns on. */}
      <Section letter="K" title="Data-quality checks and the officer's comments">
        {v.issues.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No issues flagged.</div> : (
          <table className="table">
            <thead><tr><th>Section</th><th>Check</th><th>Officer&apos;s explanation</th></tr></thead>
            <tbody>
              {v.issues.map((i) => (
                <tr key={i.code}>
                  <td>{i.section}</td>
                  <td><span style={{ color: i.severity === "blocking" ? "var(--priority-critical)" : i.severity === "warning" ? "var(--priority-high)" : "var(--color-neutral-600)", fontWeight: 600 }}>
                    {i.severity === "blocking" ? "Must be explained" : i.severity === "warning" ? "Warning" : "Note"}</span> · {i.message}</td>
                  <td style={{ fontSize: 13 }}>{v.comments?.[i.code] || <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {v.comments?.general && <div style={{ fontSize: 13 }}><b>General comment:</b> {v.comments.general}</div>}
        {v.amendment_reason && <div style={{ fontSize: 13 }}><b>Reason for amendment:</b> {v.amendment_reason}</div>}
      </Section>

      {(v.adjustments ?? []).length > 0 && (
        <Section letter="✎" title="Figures corrected by the OTP Officer"
          note="The report shows the corrected figure; the calculated figure from the site's records and the reason are kept here. Fixing the source record is preferred, as the report then recalculates.">
          <table className="table">
            <thead><tr><th>Figure</th><th style={{ textAlign: "right" }}>Calculated</th><th style={{ textAlign: "right" }}>Corrected</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {v.adjustments.map((a) => (
                <tr key={a.path}>
                  <td>{FIGURE_LABEL[a.path] ?? a.path}</td>
                  <td style={{ textAlign: "right" }}>{n(a.calculated)}</td>
                  <td style={{ textAlign: "right" }}><b>{n(a.adjusted)}</b></td>
                  <td style={{ fontSize: 13 }}>{a.reason}</td>
                  <td className="text-muted" style={{ fontSize: 12.5 }}>{a.by} · {fmtTime(a.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section letter="A" title="Reporting information">
        <table className="table"><tbody>
          {[["State", s.A?.state], ["LGA", s.A?.lga], ["OTP site", s.A?.otp_site], ["Facility ID", s.A?.facility_code], ["Reporting week", `${fmtDay(s.A?.week_start)} – ${fmtDay(s.A?.week_end)} (Monday to Sunday)`],
            ["Calculated", s.A?.generated_at ? fmtTime(s.A.generated_at) : "—"], ["OTP Officer", v.submitted_by], ["State Coordinator", (s.A?.coordinators ?? []).join(", ") || "—"]]
            .map(([k, val]) => <tr key={k}><td className="text-muted" style={{ width: 200 }}>{k}</td><td>{val ?? "—"}</td></tr>)}
        </tbody></table>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
        <Section letter="B" title="Under treatment at the start of the week">
          <SexTable rows={[["SAM", s.B?.SAM], ["HR MAM", null, NA]]} />
        </Section>
        <Section letter="F" title="Under treatment at the end of the week"
          note={<>{F.formula}. {reconciled ? "✓ Reconciled with the children under treatment." : "✗ Does not match the children under treatment: see the explanation in K."}</>}>
          <table className="table">
            <thead><tr><th></th><th style={{ textAlign: "right" }}>Male</th><th style={{ textAlign: "right" }}>Female</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
            <tbody>
              <tr><td>SAM, calculated</td><td style={{ textAlign: "right" }}>{n(F.calculated?.M)}</td><td style={{ textAlign: "right" }}>{n(F.calculated?.F)}</td><td style={{ textAlign: "right" }}><b>{n(F.calculated?.total)}</b></td></tr>
              <tr><td>SAM, children under treatment</td><td style={{ textAlign: "right" }}>{n(F.actual?.M)}</td><td style={{ textAlign: "right" }}>{n(F.actual?.F)}</td><td style={{ textAlign: "right" }}><b>{n(F.actual?.total)}</b></td></tr>
              <tr><td>HR MAM</td><td colSpan={3} className="text-muted" style={{ textAlign: "right" }}>{NA}</td></tr>
            </tbody>
          </table>
        </Section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
        <Section letter="C" title="New enrollment (new cases)" note={<>Age on the admission date. Returned defaulters: {n(s.C?.SAM?.other_admissions?.returned_defaulter)} · from stabilisation care: {n(s.C?.SAM?.other_admissions?.from_stabilisation)} (counted in the caseload, not as new cases). HR MAM: not applicable.</>}>
          <table className="table">
            <thead><tr><th>SAM</th><th style={{ textAlign: "right" }}>6–23 months</th><th style={{ textAlign: "right" }}>24–59 months</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
            <tbody>
              <tr><td>Male</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.M_6_23)}</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.M_24_59)}</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.M)}</td></tr>
              <tr><td>Female</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.F_6_23)}</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.F_24_59)}</td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.F)}</td></tr>
              <tr><td><b>Total</b></td><td></td><td></td><td style={{ textAlign: "right" }}><b>{n(s.C?.SAM?.total)}</b></td></tr>
            </tbody>
          </table>
        </Section>
        <Section letter="D" title="Transfers between OTP sites" note="Not counted as admissions or discharges; the child keeps one Child ID and history.">
          <SexTable rows={[["SAM transferred in", s.D?.SAM?.in], ["SAM transferred out", s.D?.SAM?.out], ["HR MAM", null, NA]]} />
        </Section>
      </div>

      <Section letter="E" title="Discharges and other outcomes (SAM)" note="An absence is not a default: a child becomes a defaulter after 3 consecutive absences, when the outcome is recorded. Cured only when every discharge criterion is met and confirmed. HR MAM: not applicable.">
        <SexTable rows={OUTCOMES.map(([k, label]) => [label, s.E?.SAM?.[k]] as [string, BySex])} />
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
        <Section letter="G" title="RUTF stock" note={<>From the stock ledger; {g.sachets_per_carton ?? "—"} sachets a carton. Expected closing = opening + received − dispensed − issued − losses + adjustments. Dispensed at child visits: {n(g.dispensed_at_child_visits)}{g.dispensed_status === "missing" ? " · daily dispensing missing this week" : ""}.</>}>
          <table className="table">
            <thead><tr><th></th><th style={{ textAlign: "right" }}>Cartons</th><th style={{ textAlign: "right" }}>Sachets</th></tr></thead>
            <tbody>
              {[["Opening balance", g.opening], ["Received", g.received], ["Dispensed to children", g.dispensed], ["Issued to other facilities", g.issued], ["Lost or damaged", g.losses], ["Adjustments", g.adjustments], ["Expected closing balance", g.expected_closing]]
                .map(([k, val]) => (
                  <tr key={k as string}><td>{k as string}</td>
                    {/* No daily dispensing recorded: the figure is missing, not zero (brief §4). */}
                    {k === "Dispensed to children" && g.dispensed_status === "missing"
                      ? <td colSpan={2} style={{ textAlign: "right", color: "var(--priority-high)" }}>Missing: no daily dispensing recorded</td>
                      : <><td style={{ textAlign: "right" }}>{cartons(val)}</td><td style={{ textAlign: "right" }}>{n(val)}</td></>}
                  </tr>
                ))}
              <tr><td>Physical count{g.count_date ? ` (${fmtDay(g.count_date)})` : ""}</td>
                {g.physical_count === null || g.physical_count === undefined ? <td colSpan={2} className="text-muted" style={{ textAlign: "right" }}>Pending: no count this week</td>
                  : <><td style={{ textAlign: "right" }}>{cartons(g.physical_count)}</td><td style={{ textAlign: "right" }}>{n(g.physical_count)}</td></>}</tr>
              <tr><td><b>Discrepancy</b></td><td></td><td style={{ textAlign: "right", color: g.discrepancy ? "var(--priority-critical)" : undefined }}><b>{g.discrepancy === null || g.discrepancy === undefined ? "—" : n(g.discrepancy)}</b></td></tr>
            </tbody>
          </table>
        </Section>
        <Section letter="H" title="MNP stock and distribution" note="Doses are children reached, not stock units.">
          {s.H?.status === "not_recorded" ? <div className="text-muted" style={{ fontSize: 13 }}>Not recorded: no MNP stock or doses recorded at this site yet (not zero).</div> : (
            <table className="table"><tbody>
              {[["Opening balance (sachets)", s.H?.opening], ["Received", s.H?.received], ["Distributed", s.H?.distributed], ["Lost", s.H?.losses], ["Adjustments", s.H?.adjustments], ["Expected closing", s.H?.expected_closing],
                ["Physical count", s.H?.physical_count], ["Discrepancy", s.H?.discrepancy], ["1st dose (children)", s.H?.doses?.dose_1], ["2nd dose (children)", s.H?.doses?.dose_2], ["3rd dose (children)", s.H?.doses?.dose_3]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
          )}
        </Section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
        <Section letter="I" title="MUAC screening (6–59 months)" note={<>Screening events of children 6–59 months at the OTP site this week, by the colour the rules computed; a child screened twice counts twice (W7). Children screened are not all enrolled.{s.I?.outside_6_59 ? ` Screenings of other ages, not counted: ${s.I.outside_6_59}.` : ""}</>}>
          <SexTable rows={[["Green (over 12.5 cm)", s.I?.green], ["Yellow (11.5–12.5 cm)", s.I?.yellow], ["Red (under 11.5 cm)", s.I?.red], ["On a cut-off (clinical review)", s.I?.boundary], ["Total screened", s.I?.total]]} />
        </Section>
        <Section letter="J" title="IYCF support groups and health education" note="As recorded per session. Pregnant, breastfeeding and other women do not overlap; the total is the attendance, so a woman who comes twice counts twice (W8).">
          {s.J?.status === "none_recorded" ? <div className="text-muted" style={{ fontSize: 13 }}>No sessions recorded this week.</div> : (
            <table className="table"><tbody>
              {[["Sessions held", s.J?.sessions], ["IYCF support groups", s.J?.support_groups], ["Health education", s.J?.health_education], ["Pregnant women reached", s.J?.pregnant_women],
                ["Breastfeeding women reached", s.J?.breastfeeding_women], ["Other women reached", s.J?.other_women], ["Total attendance", s.J?.total_participants]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
          )}
        </Section>
      </div>

      <Section letter="L" title="Visits, follow-up and referrals"
        note={<>RUTF recommended is from the 92 g ration table at each visit&apos;s weight; none is recommended while a referral is open or with severe oedema or a poor appetite (booklet G4).
          &ldquo;Since the previous visit&rdquo; is the direction of change in the measurements, not a clinical judgement (RULEBOOK Q14).</>}>
        {!s.L ? <div className="text-muted" style={{ fontSize: 13 }}>Not in this version (submitted before follow-up was recorded).</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
            <table className="table"><tbody>
              {[["Admission visits", s.L.visits?.admission], ["Second visits", s.L.visits?.second], ["Third visits", s.L.visits?.third],
                ["Fourth or later visits", s.L.visits?.fourth_or_later], ["Absences", s.L.visits?.absent]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
            <table className="table"><tbody>
              {[["RUTF packets recommended", s.L.rutf?.recommended], ["RUTF packets given", s.L.rutf?.given], ["Visits where given ≠ recommended", s.L.rutf?.visits_differing],
                ["Visits with none recommended", s.L.rutf?.visits_withheld], ["Given anyway, with the OTP Officer's reason", s.L.rutf?.given_while_withheld]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
            <table className="table"><tbody>
              {[["Improved since the previous visit", s.L.recovery?.improved], ["No change", s.L.recovery?.unchanged], ["Worse", s.L.recovery?.deteriorated],
                ["Referrals made", s.L.referrals?.made], ["Referrals open at the end of the week", s.L.referrals?.open_at_week_end]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
            <table className="table"><tbody>
              {[["Scheduled visits due", s.L.appointments?.due_in_week], ["Attended", s.L.appointments?.attended], ["Missed", s.L.appointments?.missed],
                ["Overdue at the end of the week", s.L.appointments?.overdue_at_week_end], ["RUTF photos not yet sent", s.L.awaiting_photo],
                ["Admission visits not recorded", s.L.admission_visit_missing]]
                .map(([k, val]) => <tr key={k as string}><td>{k as string}</td><td style={{ textAlign: "right" }}>{n(val)}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </Section>

      <Section letter="·" title="Versions">
        <table className="table">
          <thead><tr><th>Version</th><th>Submitted</th><th>Decision</th><th>Note</th><th style={{ textAlign: "right" }}>Corrections</th></tr></thead>
          <tbody>
            {r.versions.map((x) => (
              <tr key={x.version}>
                <td>{x.version}{x.amendment ? " (amendment)" : ""}</td>
                <td>{x.submitted_by} · {fmtTime(x.submitted_at)}</td>
                <td>{x.decision ? `${DECISION_LABEL[x.decision] ?? x.decision} by ${x.decided_by} · ${fmtTime(x.decided_at!)}` : <span className="text-muted">{x.review_started_at ? "Under review" : "Waiting"}</span>}</td>
                <td style={{ fontSize: 13 }}>{x.decision_note ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{(x.adjustments ?? []).length || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
