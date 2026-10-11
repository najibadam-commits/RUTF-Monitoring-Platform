import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { canAccessLgaReports } from "@/lib/rbac";
import { OpenLgaReportButton } from "@/components/reports/LgaReportControls";
import { LGA_STATUS } from "@/components/reports/lgaStatus";

export const metadata: Metadata = { title: "LGA Weekly Reports" };

// LGA Weekly Reports (DECISIONS R171): for one week, each LGA's report — combined automatically
// from its accepted OTP reports, reviewed and submitted by the LGA Nutrition Officer, accepted by
// the State Nutrition Officer (the State Coordinator may query or return it) — and, for the state
// level, the statewide report combined from the accepted LGA reports. lga_reports_overview()
// scopes the LGAs to the user's jurisdiction. Aggregates only.

type Row = {
  lga_id: string; lga: string; report_id: string | null; status: string; version: number | null; amendment: boolean | null;
  submitted_at: string | null; decided_at: string | null; sites: number; sites_accepted: number; new_cases: string | null; closing: string | null;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Overview = {
  week_start: string; week_end: string; lgas: Row[]; expected: number; accepted: number; pending_review: number; queried: number; returned: number; not_submitted: number;
  statewide: { sections: Json; store: Json } | null; i_prepare: string[];
};

function mondays(n: number): string[] {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (new Date(today).getUTCDay() + 6) % 7;
  return Array.from({ length: n }, (_, i) => new Date(today - (dow + 7 * i) * 86_400_000).toISOString().slice(0, 10));
}
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const n = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));

export default async function LgaReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (!canAccessLgaReports(profile.role, level)) redirect("/dashboard");
  const sp = await searchParams;
  const weeks = mondays(9);
  const week = sp.week && weeks.includes(sp.week) ? sp.week : weeks[1];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_reports_overview", { p_week_start: week });
  const o = data as unknown as Overview | null;
  const s = o?.statewide?.sections;
  const store = o?.statewide?.store;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ marginBottom: 2 }}>LGA Weekly Reports</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
            Each LGA&apos;s weekly report is combined automatically from the OTP reports the LGA Nutrition Officer has accepted — each counted once,
            recalculated when a source report is corrected and accepted again — with the LGA store&apos;s stock and the week&apos;s supply requests.
            The LGA Nutrition Officer reviews it against the OTP reports and submits it; the State Nutrition Officer accepts, queries, returns or
            rejects it; the State Coordinator may query or return it. The statewide report adds up the accepted LGA reports.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Link className="btn btn-secondary" href="/lga-reports/monthly"><i className="ph ph-calendar" /> Monthly figures</Link>
          {level === "lga" && <OpenLgaReportButton week={week} />}
        </div>
      </div>
      <form className="filter-bar" method="get">
        <select className="input" name="week" defaultValue={week} aria-label="Reporting week" style={{ maxWidth: 240 }}>
          {weeks.map((w, i) => <option key={w} value={w}>Week of {fmtDay(w)}{i === 0 ? " (this week)" : ""}</option>)}
        </select>
        <button className="btn btn-secondary" type="submit"><i className="ph ph-funnel" /> Apply</button>
      </form>
      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the reports: {error.message}</div>}
      {o && (
        <>
          <div className="kpi-sub">Reporting week {fmtDay(o.week_start)} – {fmtDay(o.week_end)}</div>
          <div className="kpi-row">
            {[
              { label: "LGAs", value: o.expected, sub: "In your area" },
              { label: "Accepted", value: o.accepted, sub: "By the State Nutrition Officer" },
              { label: "Waiting for review", value: o.pending_review, sub: "Submitted or under review" },
              { label: "Queried", value: o.queried, sub: "Waiting for the LGA's answer" },
              { label: "Returned", value: o.returned, sub: "For correction" },
              { label: "Not submitted", value: o.not_submitted, sub: "Draft or not started" },
            ].map((t) => (
              <div key={t.label} className="card elev-sm kpi-card">
                <div className="kpi-label">{t.label}</div><div className="kpi-value">{t.value.toLocaleString("en-GB")}</div><div className="kpi-sub">{t.sub}</div>
              </div>
            ))}
          </div>

          {!o.statewide && o.accepted === 0 && (level === "state" || ["state_coordinator", "super_admin", "project_admin"].includes(profile.role)) && (
            <div className="card elev-sm" style={{ gap: 4 }}>
              <div className="card-title">Statewide report</div>
              <div className="text-muted" style={{ fontSize: 13 }}>No LGA report has been accepted for this week yet. The statewide figures appear as the State Nutrition Officer accepts them.</div>
            </div>
          )}
          {o.statewide && (
            <div className="card elev-sm" style={{ gap: 8 }}>
              <div className="card-title">Statewide report · from {o.accepted} accepted LGA report{o.accepted === 1 ? "" : "s"}</div>
              <div className="kpi-row">
                {[
                  ["Under treatment at the start", s?.B?.SAM?.total], ["New SAM cases", s?.C?.SAM?.total], ["Cured", s?.E?.SAM?.cured?.total],
                  ["Defaulted", s?.E?.SAM?.defaulted?.total], ["Died", s?.E?.SAM?.died?.total], ["Under treatment at the end", s?.F?.SAM?.actual?.total],
                  ["Children screened (MUAC)", s?.I?.total?.total], ["RUTF dispensed at OTP sites (sachets)", s?.G?.dispensed],
                  ["RUTF at OTP sites, counted (sachets)", s?.G?.physical_count], ["LGA stores: received (sachets)", store?.received],
                  ["LGA stores: issued to OTP sites", store?.issued], ["LGA stores: closing balance", store?.closing],
                ].map(([label, v]) => (
                  <div key={label as string} className="card kpi-card" style={{ boxShadow: "none" }}>
                    <div className="kpi-label">{label as string}</div><div className="kpi-value">{n(v)}</div>
                  </div>
                ))}
              </div>
              {o.accepted < o.expected && <div className="kpi-sub">{o.expected - o.accepted} LGA report{o.expected - o.accepted === 1 ? " is" : "s are"} not yet accepted and not included.</div>}
            </div>
          )}

          <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>LGA</th><th>Status</th><th style={{ textAlign: "right" }}>OTP reports accepted</th><th style={{ textAlign: "right" }}>New cases</th><th style={{ textAlign: "right" }}>Under treatment</th><th>Submitted</th><th></th></tr></thead>
              <tbody>
                {o.lgas.map((r) => {
                  const st = LGA_STATUS[r.status] ?? LGA_STATUS.not_started;
                  return (
                    <tr key={r.lga_id}>
                      <td>{r.lga}</td>
                      <td><span style={{ color: st.colour, fontWeight: 600 }}>● {st.label}</span>{r.amendment ? <span className="text-muted"> · amendment</span> : null}</td>
                      <td style={{ textAlign: "right" }}>{r.sites_accepted} of {r.sites}</td>
                      <td style={{ textAlign: "right" }}>{n(r.new_cases)}</td>
                      <td style={{ textAlign: "right" }}>{n(r.closing)}</td>
                      <td className="text-muted" style={{ fontSize: 12.5 }}>{r.submitted_at ? new Date(r.submitted_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—"}</td>
                      <td>{r.report_id ? <Link href={`/lga-reports/${r.report_id}`}>Open</Link> : null}</td>
                    </tr>
                  );
                })}
                {o.lgas.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No LGAs in your area.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
