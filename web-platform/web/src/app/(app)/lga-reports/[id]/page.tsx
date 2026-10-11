import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { canAccessLgaReports } from "@/lib/rbac";
import { OpenQuery, ReportHistory, ReviewPanel, type ReportEvent } from "@/components/reports/ReviewPanel";
import { LgaOfficerPanel } from "@/components/reports/LgaReportControls";
import { LGA_STATUS } from "@/components/reports/lgaStatus";

export const metadata: Metadata = { title: "LGA Weekly Report" };

// One LGA weekly report (DECISIONS R171). While it is a draft (or returned) the figures are live:
// the sum of the LGA's accepted OTP reports, each counted once, with every OTP site listed by
// status so missing, pending, queried and rejected reports are visible. Once submitted, the
// submitted version is shown as it was sent, and any source OTP report accepted again since is
// flagged. Aggregate only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Site = { facility_id: string; facility: string; facility_code: string | null; report_id: string | null; status: string; current_version: number | null;
  amendment: boolean | null; included_version: number | null; included: boolean; new_cases: string | null; closing: string | null; dispensed: string | null; physical_count: string | null };
type Calc = { header: Json; sections: Json; store: Json | null; supply_requests: Json; sites: Site[]; issues: { code: string; severity: string; facility: string; message: string }[] };
type Version = { version: number; data: Omit<Calc, "sites">; sites: Site[]; comments: string | null; amendment: boolean; amendment_reason: string | null;
  submitted_by: string; submitted_at: string; decision: string | null; decision_note: string | null; decided_by: string | null; decided_at: string | null };
type Report = {
  id: string; lga: string; status: string; amendment: boolean; week_start: string; week_end: string; draft_comments: string | null;
  live: Calc; sources_changed: string[]; versions: Version[]; events: ReportEvent[];
  can_edit: boolean; can_submit: boolean; can_answer: boolean; can_reopen: boolean; can_start_review: boolean; can_decide: boolean; can_return: boolean; can_query: boolean;
  open_query: { note: string; by: string | null; role: string | null; at: string } | null;
};

const OTP_STATUS: Record<string, string> = {
  approved: "Accepted", submitted: "Waiting for review", under_review: "Under review", queried: "Queried", returned: "Returned", rejected: "Rejected", draft: "Draft", not_started: "No report",
};
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const n = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));

export default async function LgaReportPage({ params }: { params: Promise<{ id: string }> }) {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (!canAccessLgaReports(profile.role, level)) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_report_get", { p_id: id });
  if (error || !data) notFound();
  const r = data as unknown as Report;
  const v = r.versions[0];
  // Draft / returned: live figures. Otherwise: the version as submitted.
  const live = r.status === "draft" || r.status === "returned" || !v;
  const calc: Calc = live ? r.live : { ...v.data, sites: v.sites } as Calc;
  const s = calc.sections ?? {};
  const st = LGA_STATUS[r.status] ?? LGA_STATUS.not_started;
  const missing = r.live.sites.filter((x) => !x.included).length;
  const pending = r.live.sites.filter((x) => ["submitted", "under_review", "queried"].includes(x.status)).length;
  const weekOver = new Date(`${r.week_end}T23:59:59+01:00`) < new Date();

  const figures: [string, unknown][] = [
    ["Under treatment at the start", s.B?.SAM?.total], ["New SAM cases", s.C?.SAM?.total], ["Transfers in", s.D?.SAM?.in?.total], ["Transfers out", s.D?.SAM?.out?.total],
    ["Cured", s.E?.SAM?.cured?.total], ["Defaulted", s.E?.SAM?.defaulted?.total], ["Died", s.E?.SAM?.died?.total], ["Non-recovered", s.E?.SAM?.non_recovered?.total],
    ["Under treatment at the end", s.F?.SAM?.actual?.total], ["Children screened (MUAC)", s.I?.total?.total], ["IYCF sessions", s.J?.sessions], ["Referrals made", s.L?.referrals?.made],
  ];
  const stock: [string, unknown][] = [
    ["OTP sites: opening", s.G?.opening], ["OTP sites: received", s.G?.received], ["OTP sites: dispensed", s.G?.dispensed], ["OTP sites: losses", s.G?.losses],
    ["OTP sites: counted at the end", s.G?.physical_count], ["OTP sites: discrepancy", s.G?.discrepancy],
    ["LGA store: opening", calc.store?.opening], ["LGA store: received from the State", calc.store?.received], ["LGA store: issued to OTP sites", calc.store?.issued],
    ["LGA store: losses", calc.store?.losses], ["LGA store: closing", calc.store?.closing],
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link href={`/lga-reports?week=${r.week_start}`} style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> LGA Weekly Reports</Link>
        <h2 style={{ margin: "6px 0 2px" }}>{r.lga} LGA · week of {fmtDay(r.week_start)}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {fmtDay(r.week_start)} – {fmtDay(r.week_end)} · <span style={{ color: st.colour, fontWeight: 600 }}>● {st.label}</span>{r.amendment ? " (amendment)" : ""}
          {v ? ` · version ${v.version} submitted by ${v.submitted_by} on ${fmtTime(v.submitted_at)}` : ""}
          {live ? " · live figures (recalculated from the accepted OTP reports)" : ""}
        </p>
      </div>

      <OpenQuery query={r.open_query} waitingFor="the LGA Nutrition Officer's answer" />
      {r.sources_changed.length > 0 && !live && (
        <div className="card elev-sm" style={{ borderLeft: "4px solid var(--priority-high)", fontSize: 13 }}>
          Accepted again since this version was submitted: {r.sources_changed.join(", ")}. The figures here are as submitted; return the report (or the LGA
          Nutrition Officer reopens it) to include the new versions.
        </div>
      )}
      <LgaOfficerPanel id={r.id} canEdit={r.can_edit} canSubmit={r.can_submit} canAnswer={r.can_answer} canReopen={r.can_reopen} amendment={r.amendment}
        initialComments={r.draft_comments ?? ""} weekOver={weekOver} missingSites={missing} pendingSites={pending} />
      {(r.can_decide || r.can_return || r.can_query) && (
        <ReviewPanel kind="lga" id={r.id} canAccept={r.can_decide} canReturn={r.can_return} canQuery={r.can_query} startReview={r.can_start_review}
          intro={r.can_decide
            ? "Check the combined figures, the LGA store's stock and the OTP sites without an accepted report against the LGA Nutrition Officer's comments. Accept it, query it (answered without changing the figures), return it for correction, or reject it. Accepted reports go into the statewide report."
            : "As State Coordinator you may query the report or return it for correction on technical grounds. The State Nutrition Officer accepts or rejects it."} />
      )}
      {v?.comments && !live && <div className="card elev-sm" style={{ fontSize: 13 }}><span className="text-muted">LGA Nutrition Officer&apos;s comments: </span>{v.comments}</div>}

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div className="card-title">OTP sites · {calc.sites.filter((x) => x.included).length} of {calc.sites.length} included</div>
        <table className="table">
          <thead><tr><th>OTP site</th><th>Report</th><th>Included</th><th style={{ textAlign: "right" }}>New cases</th><th style={{ textAlign: "right" }}>Under treatment</th><th style={{ textAlign: "right" }}>RUTF dispensed</th><th style={{ textAlign: "right" }}>Counted</th></tr></thead>
          <tbody>
            {calc.sites.map((x) => (
              <tr key={x.facility_id}>
                <td>{x.facility}{x.facility_code ? <div className="text-muted" style={{ fontSize: 12 }}>{x.facility_code}</div> : null}</td>
                <td>{x.report_id && x.current_version ? <Link href={`/weekly-reports/${x.report_id}`}>{OTP_STATUS[x.status] ?? x.status}</Link> : (OTP_STATUS[x.status] ?? x.status)}{x.amendment ? " · amendment" : ""}</td>
                <td>{x.included ? `Yes · v${x.included_version}` : <span style={{ color: "var(--priority-high)" }}>No</span>}</td>
                <td style={{ textAlign: "right" }}>{n(x.new_cases)}</td><td style={{ textAlign: "right" }}>{n(x.closing)}</td>
                <td style={{ textAlign: "right" }}>{n(x.dispensed)}</td><td style={{ textAlign: "right" }}>{n(x.physical_count)}</td>
              </tr>
            ))}
            {calc.sites.length > 0 && (
              <tr style={{ fontWeight: 700 }}><td>Combined</td><td></td><td></td><td style={{ textAlign: "right" }}>{n(s.C?.SAM?.total)}</td><td style={{ textAlign: "right" }}>{n(s.F?.SAM?.actual?.total)}</td>
                <td style={{ textAlign: "right" }}>{n(s.G?.dispensed)}</td><td style={{ textAlign: "right" }}>{n(s.G?.physical_count)}</td></tr>
            )}
          </tbody>
        </table>
        {calc.issues?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {calc.issues.map((i) => <li key={i.code + i.facility} style={{ color: i.severity === "blocking" ? "var(--priority-critical)" : undefined }}>{i.message}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16 }}>
        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">Caseload, outcomes and screening (SAM)</div>
          <table className="table"><tbody>{figures.map(([k, val]) => <tr key={k}><td>{k}</td><td style={{ textAlign: "right" }}><b>{n(val)}</b></td></tr>)}</tbody></table>
        </div>
        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">RUTF stock (sachets)</div>
          <table className="table"><tbody>{stock.map(([k, val]) => <tr key={k}><td>{k}</td><td style={{ textAlign: "right" }}><b>{n(val)}</b></td></tr>)}</tbody></table>
          <div className="kpi-sub">
            Supply requests this week: {n(calc.supply_requests?.from_otp_sites?.count)} from OTP sites ({n(calc.supply_requests?.from_otp_sites?.sachets_requested)} sachets asked,{" "}
            {n(calc.supply_requests?.from_otp_sites?.sachets_approved)} approved) · {n(calc.supply_requests?.to_state?.count)} to the State store ({n(calc.supply_requests?.to_state?.sachets_requested)} asked).
          </div>
        </div>
      </div>

      <ReportHistory events={r.events ?? []} />

      {r.versions.length > 0 && (
        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title">Versions</div>
          <table className="table">
            <thead><tr><th>Version</th><th>Submitted</th><th>Decision</th><th>Note</th></tr></thead>
            <tbody>
              {r.versions.map((x) => (
                <tr key={x.version}>
                  <td>{x.version}{x.amendment ? " (amendment)" : ""}</td>
                  <td>{x.submitted_by} · {fmtTime(x.submitted_at)}{x.amendment_reason ? <div className="text-muted" style={{ fontSize: 12 }}>{x.amendment_reason}</div> : null}</td>
                  <td>{x.decision ? `${x.decision[0].toUpperCase()}${x.decision.slice(1)} by ${x.decided_by} · ${fmtTime(x.decided_at!)}` : <span className="text-muted">No decision yet</span>}</td>
                  <td style={{ fontSize: 13 }}>{x.decision_note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
