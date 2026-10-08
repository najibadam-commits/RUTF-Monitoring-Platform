"use client";

import { useState } from "react";
import Link from "next/link";
import type { Database } from "@/lib/types/database";
import { updateSettingsAction } from "@/lib/actions/settings";

// System Settings — only what the platform actually uses. The TPM-era switches (SMS alerts,
// auto-assign by ward, email-alert toggle, retention / export format, organisation name, timezone,
// default map view) were never read by anything and were removed (DECISIONS R54); their columns
// stay in `settings`, unused.

type Settings = Database["public"]["Tables"]["settings"]["Row"];
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const TEST_SENDER = "onboarding@resend.dev";

/** One line of the go-live checklist (DECISIONS R97): done, still to do, or a programme decision. */
export type ReadinessItem = { title: string; state: "done" | "todo" | "decision"; detail: string; href?: string };
const STATE_STYLE: Record<ReadinessItem["state"], { label: string; icon: string; color: string }> = {
  done: { label: "Done", icon: "ph-check-circle", color: "var(--status-resolved)" },
  todo: { label: "To do", icon: "ph-circle-dashed", color: "var(--priority-high)" },
  decision: { label: "Programme decision", icon: "ph-users-three", color: "var(--color-accent-700)" },
};

// Security and data protection, as checked in the permissions review (docs/PERMISSIONS_REVIEW.md, 3 Oct 2026).
const SAFEGUARDS = [
  { icon: "ph-lock-key", text: "Row-level security on every table: the database decides who sees what, for the web, the app and the API alike" },
  { icon: "ph-user-minus", text: "No data or function open to signed-out users" },
  { icon: "ph-folder-lock", text: "All four file stores (photos, evidence) private" },
  { icon: "ph-users-three", text: "Every role tried against every rule: 208 of 208 checks pass" },
  { icon: "ph-baby", text: "No child or caregiver names or IDs: aggregate OTP tallies only" },
  { icon: "ph-clock-counter-clockwise", text: "Changes to accounts, reference data and ledger status written to the Audit Trail by the database" },
];

export function SettingsClient({ settings, readiness = [], automatic }: { settings: Settings; readiness?: ReadinessItem[]; automatic?: { lastAuto: string | null; lastWeek: number } }) {
  const [saved, setSaved] = useState<string | null>(settings.email_from_address);
  const [sender, setSender] = useState(settings.email_from_address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function saveSender() {
    const v = sender.trim();
    if (v && !EMAIL_RE.test(v)) {
      setError("Enter a single email address, e.g. noreply@your-domain.org");
      return;
    }
    setPending(true);
    const result = await updateSettingsAction({ email_from_address: v || null });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(v || null);
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>System Settings</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Platform-wide settings and the go-live checklist. Facilities, lots, dosing rules and thresholds are under{" "}
          <Link href="/data-sets">Master Data</Link>; accounts under <Link href="/users">Users &amp; Access</Link>.
        </p>
      </div>

      {readiness.length > 0 && (() => {
        const done = readiness.filter((r) => r.state === "done").length;
        return (
          <div className="card elev-sm" style={{ padding: 0 }}>
            <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="card-title">Go-live readiness</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  What stands between the pilot platform and real data. Checked live where the platform can tell; the rest are
                  decisions for the programme.
                </div>
              </div>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 12.5, marginBottom: 4 }}><strong>{done}</strong> of {readiness.length} done</div>
                <div style={{ height: 8, borderRadius: 4, background: "var(--color-accent-100)" }}>
                  <div style={{ height: "100%", width: `${(done * 100) / readiness.length}%`, borderRadius: 4, background: "var(--status-resolved)" }} />
                </div>
              </div>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {readiness.map((r) => {
                const st = STATE_STYLE[r.state];
                const body = (
                  <>
                    <i className={`ph-fill ${st.icon}`} aria-hidden="true" style={{ color: st.color, fontSize: 18, flex: "none", marginTop: 1 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{r.title}</span>
                      <span className="text-muted" style={{ display: "block", fontSize: 12 }}>{r.detail}</span>
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: st.color, whiteSpace: "nowrap" }}>{st.label}</span>
                  </>
                );
                const style = { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", borderTop: "1px solid var(--color-divider)", textDecoration: "none", color: "inherit" } as const;
                return (
                  <li key={r.title}>
                    {r.href ? <Link href={r.href} style={style}>{body}</Link> : <div style={style}>{body}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="card-title">Running automatically</div>
          {automatic && (
            <span className="kpi-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="ph-fill ph-pulse" aria-hidden="true" style={{ color: automatic.lastAuto ? "var(--status-resolved)" : "var(--color-neutral-500)" }} />
              {automatic.lastAuto
                ? <>Last automatic Finding {new Date(automatic.lastAuto).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {automatic.lastWeek.toLocaleString("en-GB")} in the last 7 days</>
                : "No automatic Finding raised yet"}
            </span>
          )}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li>Every night (02:30 WAT) each store&apos;s and OTP site&apos;s ledger is checked against the thresholds, and each supervision visit is checked as it is recorded; discrepancies become Findings.</li>
          <li>Each morning (07:00 WAT) administrators get a digest of phones that have stopped syncing.</li>
          <li>Review decisions send in-app notifications and emails to the people involved.</li>
          <li>Every change to facilities, lots, rules, thresholds, accounts and ledger status is written to the Audit Trail.</li>
        </ul>
      </div>

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="card-title">Security and data protection</div>
          <span className="kpi-sub">As checked in the permissions review, 3 Oct 2026 · re-run after every change to the database</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "6px 16px" }}>
          {SAFEGUARDS.map((g) => (
            <li key={g.text} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
              <i className={`ph-fill ${g.icon}`} aria-hidden="true" style={{ color: "var(--status-resolved)", fontSize: 15, marginTop: 2, flex: "none" }} />
              <span>{g.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card elev-sm" style={{ gap: 12 }}>
        <div className="card-title">Notification emails</div>
        <div className="field">
          <label htmlFor="email-sender">Send notification emails from</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id="email-sender"
              className="input"
              type="email"
              value={sender}
              placeholder={TEST_SENDER}
              onChange={(e) => { setSender(e.target.value); setError(null); }}
              style={{ flex: "1 1 260px" }}
            />
            <button className="btn btn-primary" disabled={pending || sender.trim() === (saved ?? "")} onClick={saveSender}>
              <i className="ph ph-floppy-disk" /> Save sender
            </button>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Shown as &quot;RUTF-DTAP Monitoring Platform &lt;{saved || TEST_SENDER}&gt;&quot;. Leave empty to use Resend&apos;s test
            sender. The domain must be verified in the Resend account first — until then Resend won&apos;t send from it
            (in-app notifications are unaffected).
          </div>
          {error && <div role="alert" style={{ fontSize: 12, color: "var(--priority-critical)" }}>{error}</div>}
          {done && <div role="status" style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>Sender saved.</div>}
        </div>
      </div>

      <div className="card elev-sm" style={{ gap: 12 }}>
        <div className="card-title">Data</div>
        <p className="card-body" style={{ margin: 0 }}>
          Retention periods for photos, sync errors and records are set by the Data Protection Officer (DPIA §6) and
          aren&apos;t applied automatically yet. Exports for other users go through Data Access Requests.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a download route, not a page */}
        <a className="btn btn-secondary" style={{ width: "fit-content" }} href="/issues/export">
          <i className="ph ph-download-simple" /> Export all Findings (CSV)
        </a>
      </div>
    </div>
  );
}
