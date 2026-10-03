"use client";

import { useState, useTransition } from "react";
import { requestRutfDownloadAction } from "@/lib/actions/downloadRequests";

// Programme Reporting: the month's RUTF exports. Admins and reviewers download directly; a Viewer
// asks for approval (Download Requests), as for the Findings export.

type Kind = "kpis" | "facility_metrics" | "ledger" | "transfers";

export function RutfExportPanel({
  exports,
  months,
  defaultMonth,
  isViewer,
}: {
  exports: { kind: Kind; title: string; description: string }[];
  months: { key: string; label: string }[];
  defaultMonth: string;
  isViewer: boolean;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [requesting, setRequesting] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const monthLabel = months.find((m) => m.key === month)?.label ?? month;

  return (
    <div className="card elev-sm" style={{ gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="card-title" style={{ fontSize: 15 }}>Stock &amp; KPI exports</div>
          <div className="text-muted" style={{ fontSize: 12.5 }}>
            CSV for one month, scoped to what you can see.{" "}
            {isViewer ? "Each download needs approval — you'll be notified, then download it once from Download Requests." : "Child counts under 5 are shown as \"<5\"."}
          </div>
        </div>
        <select className="input" value={month} onChange={(e) => { setMonth(e.target.value); setMsg(null); }} aria-label="Month" style={{ maxWidth: 180 }}>
          {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {exports.map((e) => (
          <div key={e.kind} style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.title}</div>
            <div className="text-muted" style={{ fontSize: 12, flex: 1 }}>{e.description}</div>
            {isViewer ? (
              <button className="btn btn-secondary" style={{ width: "fit-content" }} onClick={() => { setRequesting(e.kind); setMsg(null); }}>
                <i className="ph ph-paper-plane-tilt" /> Request download
              </button>
            ) : (
              <a className="btn btn-secondary" style={{ width: "fit-content" }} href={`/reporting/export?kind=${e.kind}&month=${month}`}>
                <i className="ph ph-download-simple" /> Download CSV
              </a>
            )}
          </div>
        ))}
      </div>

      {isViewer && requesting && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            start(async () => {
              const r = await requestRutfDownloadAction(requesting, month, reason.trim());
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `Requested: ${exports.find((x) => x.kind === requesting)?.title}, ${monthLabel}. You'll be notified when it's decided.` });
              if (!r.error) { setRequesting(null); setReason(""); }
            });
          }}
        >
          <label style={{ fontSize: 13 }}>
            Why do you need the {exports.find((x) => x.kind === requesting)?.title.toLowerCase()} for {monthLabel}?
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setRequesting(null)}>Cancel</button>
          </div>
        </form>
      )}
      {msg && (
        <div role="status" style={{ fontSize: 13, color: msg.ok ? "inherit" : "var(--priority-critical)" }}>
          <i className={`ph ${msg.ok ? "ph-check-circle" : "ph-warning-circle"}`} aria-hidden="true" /> {msg.text}
        </div>
      )}
    </div>
  );
}
