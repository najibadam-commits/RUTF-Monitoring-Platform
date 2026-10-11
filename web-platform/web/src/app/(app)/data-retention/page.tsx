import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { RetentionMode, RetentionRunButtons } from "@/components/retention/RetentionControls";

export const metadata: Metadata = { title: "Data Retention" };

// Data Retention (DECISIONS R177; DPIA §8): how long each kind of personal data is kept, what is
// due for deletion now, and every run of the nightly job (02:00) that deletes it — child and
// caregiver identity 2 years after the last discharge, RUTF photos 1 year, the access log 2
// years, evidence photos 2 years, selfies 90 days, sync errors 180 days after resolution. Photo
// files are deleted through the Storage API. Super Admin only; counts only, never the values.

type Rule = { key: string; label: string; data: string; keep_days: number; basis: string; mode: string; dpo_approved: boolean;
  due_rows: number; due_files: number; updated_by: string | null; updated_at: string };
type RunRule = { mode: string; keep_days: number; due: number; deleted: number; files_queued: number };
type Run = { ran_at: string; dry_run: boolean; by: string | null; results: Record<string, RunRule | Record<string, unknown>> };
type Overview = { rules: Rule[]; runs: Run[]; files: { waiting: number; deleted: number; failing: number; key_stored: boolean }; schedule: string };

const period = (d: number) => (d % 365 === 0 ? `${d / 365} year${d === 365 ? "" : "s"}` : `${d} days`);
const fmtTime = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export default async function DataRetentionPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "super_admin") redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("retention_overview");
  const o = data as unknown as Overview | null;
  const due = (o?.rules ?? []).reduce((a, r) => a + Number(r.due_rows || 0), 0);
  const label = Object.fromEntries((o?.rules ?? []).map((r) => [r.key, r.label]));

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ marginBottom: 2 }}>Data Retention</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
            Personal data is deleted automatically when its retention period ends, every night at 02:00. When a child&apos;s identifying details go,
            the Child ID and the clinical record stay, no longer identifiable. Photo files are deleted from storage, not just hidden. Only counts are
            recorded here, never the deleted details. The periods are the ones proposed in the DPIA, for the Data Protection Officer to approve.
          </p>
        </div>
        <RetentionRunButtons due={due} />
      </div>
      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load data retention: {error.message}</div>}
      {o && (
        <>
          {!o.files.key_stored && (
            <div className="card elev-sm" style={{ borderLeft: "4px solid var(--priority-high)", fontSize: 13 }}>
              The storage key is not stored yet, so expired photo files wait in a queue (their records are already gone). Run{" "}
              <b>node set-storage-key.js</b> in the <b>web-platform/tools/db</b> folder once to let the job delete them.
            </div>
          )}
          <div className="kpi-row">
            <div className="card elev-sm kpi-card"><div className="kpi-label">Due for deletion now</div><div className="kpi-value">{due.toLocaleString("en-GB")}</div><div className="kpi-sub">Records past their period</div></div>
            <div className="card elev-sm kpi-card"><div className="kpi-label">Photo files waiting</div><div className="kpi-value">{o.files.waiting}</div><div className="kpi-sub">{o.files.failing ? `${o.files.failing} failing to delete` : "Queued for the Storage API"}</div></div>
            <div className="card elev-sm kpi-card"><div className="kpi-label">Photo files deleted</div><div className="kpi-value">{o.files.deleted}</div><div className="kpi-sub">Since the job started</div></div>
            <div className="card elev-sm kpi-card"><div className="kpi-label">Schedule</div><div style={{ fontWeight: 600 }}>{o.schedule}</div><div className="kpi-sub">{o.runs[0] ? `Last run ${fmtTime(o.runs[0].ran_at)}` : "Not run yet"}</div></div>
          </div>

          <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Data</th><th>Kept for</th><th style={{ textAlign: "right" }}>Due now</th><th>Approval</th><th>What happens</th></tr></thead>
              <tbody>
                {o.rules.map((r) => (
                  <tr key={r.key}>
                    <td><b>{r.label}</b><div className="text-muted" style={{ fontSize: 12 }}>{r.data}</div></td>
                    <td>{period(r.keep_days)}<div className="text-muted" style={{ fontSize: 12 }}>after {r.basis}</div></td>
                    <td style={{ textAlign: "right" }}>{Number(r.due_rows).toLocaleString("en-GB")}{Number(r.due_files) ? <div className="text-muted" style={{ fontSize: 12 }}>{r.due_files} file{Number(r.due_files) === 1 ? "" : "s"}</div> : null}</td>
                    <td style={{ fontSize: 12.5 }}>{r.dpo_approved ? "Approved by the DPO" : <span className="text-muted">Proposed (DPIA §8)</span>}</td>
                    <td><RetentionMode ruleKey={r.key} mode={r.mode} label={r.label} />{r.updated_by ? <div className="text-muted" style={{ fontSize: 11.5 }}>Set by {r.updated_by}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card elev-sm" style={{ gap: 8 }}>
            <div className="card-title">Recent runs</div>
            {o.runs.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No run yet: the first is tonight at 02:00, or use Run now.</div> : (
              <table className="table">
                <thead><tr><th>When</th><th>Run</th><th>Deleted</th></tr></thead>
                <tbody>
                  {o.runs.map((run, i) => {
                    const rules = Object.entries(run.results).filter(([k]) => k !== "files") as [string, RunRule][];
                    const deleted = rules.filter(([, v]) => v.deleted > 0);
                    return (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtTime(run.ran_at)}</td>
                        <td>{run.dry_run ? "Preview" : "Deletion"} · {run.by ?? "nightly job"}</td>
                        <td style={{ fontSize: 13 }}>{deleted.length === 0 ? <span className="text-muted">{run.dry_run ? `${rules.reduce((a, [, v]) => a + v.due, 0)} due, nothing deleted` : "Nothing was due"}</span>
                          : deleted.map(([k, v]) => <div key={k}>{label[k] ?? k}: {v.deleted}</div>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
