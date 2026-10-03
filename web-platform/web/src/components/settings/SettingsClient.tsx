"use client";

import { useState } from "react";
import type { Database } from "@/lib/types/database";
import { updateSettingsAction } from "@/lib/actions/settings";

type Settings = Database["public"]["Tables"]["settings"]["Row"];
type Tab = "general" | "notifications" | "data";
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const TEST_SENDER = "onboarding@resend.dev";

export function SettingsClient({ settings, states }: { settings: Settings; states: { id: string; name: string }[] }) {
  const [tab, setTab] = useState<Tab>("general");
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [sender, setSender] = useState(settings.email_from_address ?? "");
  const [senderError, setSenderError] = useState<string | null>(null);

  async function save(patch: Partial<Settings>) {
    setPending(true);
    const merged = { ...form, ...patch };
    setForm(merged);
    const result = await updateSettingsAction(patch);
    setPending(false);
    if (!result.error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>System Settings</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Organization-wide defaults, alerting, and data export preferences.
        </p>
      </div>
      <div className="seg" style={{ width: "fit-content" }}>
        <label className="seg-opt">
          <input type="radio" checked={tab === "general"} onChange={() => setTab("general")} />
          General
        </label>
        <label className="seg-opt">
          <input type="radio" checked={tab === "notifications"} onChange={() => setTab("notifications")} />
          Notifications
        </label>
        <label className="seg-opt">
          <input type="radio" checked={tab === "data"} onChange={() => setTab("data")} />
          Data &amp; Export
        </label>
      </div>

      {tab === "general" && (
        <div className="card elev-sm" style={{ gap: 14 }}>
          <div className="field">
            <label>Organization Name</label>
            <input className="input" value={form.org_name} onChange={(e) => setForm((f) => ({ ...f, org_name: e.target.value }))} />
          </div>
          <div className="field">
            <label>Default Timezone</label>
            <select className="input" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
              <option>West Africa Time (WAT)</option>
              <option>UTC</option>
              <option>Eastern European Time (EET)</option>
            </select>
          </div>
          <div className="field">
            <label>Default GIS Map View</label>
            <select className="input" value={form.default_state_id ?? ""} onChange={(e) => setForm((f) => ({ ...f, default_state_id: e.target.value || null }))}>
              <option value="">All States</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: "fit-content" }} disabled={pending} onClick={() => save({ org_name: form.org_name, timezone: form.timezone, default_state_id: form.default_state_id })}>
            <i className="ph ph-floppy-disk" /> Save Changes
          </button>
          {saved && <div style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>Settings saved.</div>}
        </div>
      )}

      {tab === "notifications" && (
        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="email-sender">Send notification emails from</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                id="email-sender"
                className="input"
                type="email"
                value={sender}
                placeholder={TEST_SENDER}
                onChange={(e) => { setSender(e.target.value); setSenderError(null); }}
                style={{ flex: "1 1 260px" }}
              />
              <button
                className="btn btn-primary"
                disabled={pending || sender.trim() === (form.email_from_address ?? "")}
                onClick={() => {
                  const v = sender.trim();
                  if (v && !EMAIL_RE.test(v)) { setSenderError("Enter a single email address, e.g. noreply@your-domain.org"); return; }
                  save({ email_from_address: v || null });
                }}
              >
                <i className="ph ph-floppy-disk" /> Save sender
              </button>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Shown as &quot;RUTF-DTAP Monitoring Platform &lt;{form.email_from_address || TEST_SENDER}&gt;&quot;. Leave empty to use
              Resend&apos;s test sender. The domain must be verified in the Resend account first — until then Resend won&apos;t
              send from it (in-app notifications are unaffected).
            </div>
            {senderError && <div role="alert" style={{ fontSize: 12, color: "var(--priority-critical)" }}>{senderError}</div>}
          </div>
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
            Changes save automatically.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Email alerts for new issues</span>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" checked={form.email_alerts_on} onChange={() => save({ email_alerts_on: true })} />
                On
              </label>
              <label className="seg-opt">
                <input type="radio" checked={!form.email_alerts_on} onChange={() => save({ email_alerts_on: false })} />
                Off
              </label>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>SMS alerts for critical priority</span>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" checked={form.sms_alerts_on} onChange={() => save({ sms_alerts_on: true })} />
                On
              </label>
              <label className="seg-opt">
                <input type="radio" checked={!form.sms_alerts_on} onChange={() => save({ sms_alerts_on: false })} />
                Off
              </label>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Auto-assign DRI by ward</span>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" checked={form.auto_assign_by_ward} onChange={() => save({ auto_assign_by_ward: true })} />
                On
              </label>
              <label className="seg-opt">
                <input type="radio" checked={!form.auto_assign_by_ward} onChange={() => save({ auto_assign_by_ward: false })} />
                Off
              </label>
            </div>
          </div>
          {saved && <div style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>Settings saved.</div>}
        </div>
      )}

      {tab === "data" && (
        <div className="card elev-sm" style={{ gap: 14 }}>
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
            Changes save automatically.
          </p>
          <div className="field">
            <label>Data Retention Period</label>
            <select className="input" value={form.data_retention} onChange={(e) => save({ data_retention: e.target.value })}>
              <option>6 months</option>
              <option>12 months</option>
              <option>24 months</option>
              <option>Indefinite</option>
            </select>
          </div>
          <div className="field">
            <label>Export Format</label>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" checked={form.export_format === "csv"} onChange={() => save({ export_format: "csv" })} />
                CSV
              </label>
              <label className="seg-opt">
                <input type="radio" checked={form.export_format === "json"} onChange={() => save({ export_format: "json" })} />
                JSON
              </label>
            </div>
          </div>
          <a className="btn btn-secondary" style={{ width: "fit-content" }} href="/issues/export">
            <i className="ph ph-download-simple" /> Export All Issue Data
          </a>
          {saved && <div style={{ fontSize: 12.5, color: "var(--status-resolved)" }}>Settings saved.</div>}
        </div>
      )}
    </div>
  );
}
