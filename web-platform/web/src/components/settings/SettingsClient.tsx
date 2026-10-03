"use client";

import { useState } from "react";
import type { Database } from "@/lib/types/database";
import { updateSettingsAction } from "@/lib/actions/settings";

// System Settings — only what the platform actually uses. The TPM-era switches (SMS alerts,
// auto-assign by ward, email-alert toggle, retention / export format, organisation name, timezone,
// default map view) were never read by anything and were removed (DECISIONS R54); their columns
// stay in `settings`, unused.

type Settings = Database["public"]["Tables"]["settings"]["Row"];
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const TEST_SENDER = "onboarding@resend.dev";

export function SettingsClient({ settings }: { settings: Settings }) {
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
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>System Settings</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Platform-wide settings. Thresholds, dosing rules and lots are under Data Sets.
        </p>
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
