import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { canAccessWeeklyReports } from "@/lib/rbac";

export const metadata: Metadata = { title: "Weekly OTP Reports" };

// Weekly OTP Reports (DECISIONS R148): the State Coordinator's view of one reporting week across
// the OTP sites in their state — who has submitted, what is waiting, approved or returned, which
// sites have unresolved issues or stock discrepancies — and the headline figures. Each OTP
// Officer's report is calculated live from the site's records (otp_weekly_report_compute, 0126)
// and submitted from the app; the coordinator opens it here to approve or return it. Aggregate
// only: no child is named.

type Site = {
  facility_id: string; facility: string; lga: string; report_id: string | null; status: string; version: number | null;
  amendment: boolean | null; submitted_at: string | null; decided_at: string | null; issues: number; new_cases: string | null; closing: string | null;
};
type Overview = {
  week_start: string; week_end: string; due: string; expected: number; submitted: number; approved: number; returned: number;
  not_submitted: number; with_issues: number; stock_discrepancies: number;
  totals: { new_cases: number; closing: number; cured: number; screened: number };
  sites: Site[];
};

const STATUS: Record<string, { label: string; colour: string }> = {
  submitted: { label: "Waiting for review", colour: "var(--stage-addressing)" },
  approved: { label: "Approved", colour: "var(--stage-recorded)" },
  returned: { label: "Returned for revision", colour: "var(--stage-reopened)" },
  draft: { label: "Draft, not submitted", colour: "var(--color-neutral-600)" },
  not_started: { label: "Not started", colour: "var(--color-neutral-500)" },
};

/** Mondays (yyyy-mm-dd) of the last n weeks, the latest first, computed on calendar dates. */
function mondays(n: number): string[] {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (new Date(today).getUTCDay() + 6) % 7; // 0 = Monday
  return Array.from({ length: n }, (_, i) => new Date(today - (dow + 7 * i) * 86_400_000).toISOString().slice(0, 10));
}
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function WeeklyReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!canAccessWeeklyReports(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const weeks = mondays(9);
  // Default: the last complete week (reports are submitted after the week ends).
  const week = sp.week && weeks.includes(sp.week) ? sp.week : weeks[1];
  const supabase = await createClient();
  const [lgas, { data, error }] = await Promise.all([
    getProgrammeLgas(supabase),
    supabase.rpc("otp_reports_overview", { p_week_start: week, p_lga_id: sp.lga || null }),
  ]);
  const o = data as unknown as Overview | null;
  const status = sp.status && STATUS[sp.status] ? sp.status : null;
  const sites = (o?.sites ?? []).filter((s) => !status || s.status === status || (status === "draft" && s.status === "not_started"));
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ week, lga: sp.lga ?? null, status, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/weekly-reports?${p.toString()}`;
  };

  const tiles = o ? [
    { key: null, label: "OTP sites expected", value: o.expected, sub: `Due ${fmtDay(o.due)}` },
    { key: "submitted", label: "Waiting for your review", value: o.submitted, sub: "Submitted by the OTP Officer" },
    { key: "approved", label: "Approved", value: o.approved, sub: "Final, recorded against the coordinator" },
    { key: "returned", label: "Returned for revision", value: o.returned, sub: "With your comments" },
    { key: "draft", label: "Not submitted", value: o.not_submitted, sub: new Date() > new Date(`${o.due}T23:59:59Z`) ? "Overdue" : "Not yet due" },
    { key: null, label: "With data-quality issues", value: o.with_issues, sub: `${o.stock_discrepancies} with a stock discrepancy` },
  ] : [];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Weekly OTP Reports</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
          Each OTP site&apos;s weekly report is calculated live from its records (admissions, visits, outcomes, screening, stock, MNP and IYCF sessions),
          checked for data-quality issues, reviewed by the OTP Officer and submitted from the app. Open a submitted report to approve it or return it with
          your comments. Every version is kept. Totals only: no child is named.
        </p>
      </div>
      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <select className="input" name="week" defaultValue={week} aria-label="Reporting week" style={{ maxWidth: 240 }}>
          {weeks.map((w, i) => <option key={w} value={w}>Week of {fmtDay(w)}{i === 0 ? " (this week)" : ""}</option>)}
        </select>
        <select className="input" name="lga" defaultValue={sp.lga ?? ""} aria-label="LGA" style={{ maxWidth: 200 }}>
          <option value="">All LGAs</option>
          {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {status && <input type="hidden" name="status" value={status} />}
        <button className="btn btn-secondary" type="submit"><i className="ph ph-funnel" /> Apply</button>
      </form>

      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the reports: {error.message}</div>}

      {o && (
        <>
          <div className="kpi-sub">Reporting week {fmtDay(o.week_start)} – {fmtDay(o.week_end)} (Monday to Sunday) · due {fmtDay(o.due)}</div>
          <div className="kpi-row">
            {tiles.map((t) => {
              const inner = (
                <>
                  <div className="kpi-label">{t.label}</div>
                  <div className="kpi-value">{t.value.toLocaleString("en-GB")}</div>
                  <div className="kpi-sub">{t.key && status === t.key ? "Filtered · click to clear" : t.sub}</div>
                </>
              );
              return t.key ? (
                <Link key={t.label} href={qs({ status: status === t.key ? null : t.key })} className="card elev-sm kpi-card" style={{ textDecoration: "none", color: "inherit", outline: status === t.key ? "2px solid var(--color-accent)" : undefined }}>{inner}</Link>
              ) : <div key={t.label} className="card elev-sm kpi-card">{inner}</div>;
            })}
          </div>
          <div className="kpi-row">
            {[
              { label: "New SAM cases", value: o.totals.new_cases, sub: "In submitted reports" },
              { label: "Under treatment at the end", value: o.totals.closing, sub: "Closing caseload, SAM" },
              { label: "Discharged cured", value: o.totals.cured, sub: "SAM" },
              { label: "Children screened (MUAC)", value: o.totals.screened, sub: "Screening events" },
            ].map((t) => (
              <div key={t.label} className="card elev-sm kpi-card">
                <div className="kpi-label">{t.label}</div>
                <div className="kpi-value">{t.value.toLocaleString("en-GB")}</div>
                <div className="kpi-sub">{t.sub}</div>
              </div>
            ))}
          </div>

          <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>OTP site</th><th>LGA</th><th>Status</th><th style={{ textAlign: "right" }}>Issues</th><th style={{ textAlign: "right" }}>New cases</th><th style={{ textAlign: "right" }}>Under treatment</th><th>Submitted</th><th></th></tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const st = STATUS[s.status] ?? STATUS.not_started;
                  return (
                    <tr key={s.facility_id}>
                      <td>{s.facility}</td>
                      <td>{s.lga}</td>
                      <td><span style={{ color: st.colour, fontWeight: 600 }}>● {st.label}</span>{s.amendment ? <span className="text-muted"> · amendment</span> : null}</td>
                      <td style={{ textAlign: "right", color: s.issues ? "var(--priority-high)" : undefined }}>{s.report_id && s.version ? s.issues : "—"}</td>
                      <td style={{ textAlign: "right" }}>{s.new_cases ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{s.closing ?? "—"}</td>
                      <td className="text-muted" style={{ fontSize: 12.5 }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—"}</td>
                      <td>{s.report_id && s.version ? <Link href={`/weekly-reports/${s.report_id}`}>{s.status === "submitted" ? "Review" : "Open"}</Link> : null}</td>
                    </tr>
                  );
                })}
                {sites.length === 0 && <tr><td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No OTP sites match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
