"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DownloadRequestStatusTag } from "@/components/ui/Tags";
import { decideDownloadRequestAction } from "@/lib/actions/downloadRequests";
import type { DownloadRequestRow } from "@/lib/queries/downloadRequests";
import { RESOURCE_LABEL } from "@/lib/downloadResources";
import { AccessSteps } from "@/components/downloadRequests/AccessSteps";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function DownloadRequestsTable({ requests }: { requests: DownloadRequestRow[] }) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DownloadRequestRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleApprove(id: string) {
    setApprovingId(id);
    setError(null);
    const result = await decideDownloadRequestAction(id, true, "");
    setApprovingId(null);
    if (result.error) setError(result.error);
  }

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const count = (s: DownloadRequestRow["status"]) => requests.filter((r) => r.status === s).length;
  const hours = decided.filter((r) => r.reviewed_at).map((r) => (Date.parse(r.reviewed_at!) - Date.parse(r.created_at)) / 3_600_000).sort((a, b) => a - b);
  const medianHours = hours.length ? hours[Math.floor((hours.length - 1) / 2)] : null;

  const tiles = [
    { label: "Waiting for a decision", value: pending.length, icon: "ph-hourglass-medium", tone: pending.length ? "var(--priority-high)" : undefined },
    { label: "Approved, not yet downloaded", value: count("approved"), icon: "ph-check-circle" },
    { label: "Downloaded", value: count("fulfilled"), icon: "ph-download-simple" },
    { label: "Rejected", value: count("rejected"), icon: "ph-x-circle" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Data Access Requests</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
          Partners and other Viewers can see the dashboards, but programme data leaves the platform only after you approve it.
          Each approved file covers only what the requester may see, and can be downloaded once.
          {medianHours !== null && <> Median time to a decision: {medianHours < 48 ? `${Math.max(1, Math.round(medianHours))} h` : `${(medianHours / 24).toFixed(1)} days`}.</>}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.label} className="card elev-sm" style={{ padding: 14, gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
              <i className={`ph-fill ${t.icon}`} aria-hidden="true" style={{ fontSize: 15, color: t.tone ?? "var(--color-accent-600)" }} /> {t.label}
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{t.value}</div>
          </div>
        ))}
      </div>

      <AccessSteps />

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
          {error}
        </div>
      )}

      <div className="card elev-sm" style={{ gap: 10 }}>
        <div className="card-title">Waiting for your decision</div>
        {pending.length === 0 && <div className="text-muted" style={{ fontSize: 13 }}>No requests waiting. New ones appear here, and you are notified.</div>}
        {pending.map((r) => (
          <div key={r.id} style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 14 }}>
                <strong>{r.requester?.name ?? "A Viewer"}</strong> wants <strong>{RESOURCE_LABEL[r.resource_type] ?? r.resource_type}</strong>
                <span className="text-muted"> · {r.format.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 12.5 }}><span className="text-muted">Scope:</span> {r.scope}</div>
              <div style={{ fontSize: 12.5 }}><span className="text-muted">Reason:</span> {r.reason || <span className="text-muted">None given</span>}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>Requested {when(r.created_at)}{r.requester?.email ? ` · ${r.requester.email}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={approvingId === r.id} onClick={() => handleApprove(r.id)}>
                <i className={approvingId === r.id ? "ph ph-circle-notch spin" : "ph ph-check"} /> Approve
              </button>
              <button className="btn btn-secondary" onClick={() => { setRejectNote(""); setRejectTarget(r); }}>
                <i className="ph ph-x" /> Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>Decision history</div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Requester</th>
              <th>Data</th>
              <th>Status</th>
              <th>Decided</th>
              <th>Downloaded</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.requester?.name ?? "—"}
                  <div className="text-muted" style={{ fontSize: 11.5 }}>Requested {when(r.created_at)}</div>
                </td>
                <td>
                  {RESOURCE_LABEL[r.resource_type] ?? r.resource_type} <span className="text-muted">· {r.format.toUpperCase()}</span>
                  <div className="text-muted" style={{ fontSize: 11.5, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.scope}>{r.scope}</div>
                </td>
                <td><DownloadRequestStatusTag status={r.status} /></td>
                <td className="text-muted">
                  {when(r.reviewed_at)}
                  {r.reviewer?.name && <div style={{ fontSize: 11.5 }}>by {r.reviewer.name}</div>}
                </td>
                <td className="text-muted">{when(r.fulfilled_at)}</td>
                <td className="text-muted" style={{ maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.review_note ?? undefined}>
                  {r.review_note || "—"}
                </td>
              </tr>
            ))}
            {decided.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No decisions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <Modal
          title={`Reject request from ${rejectTarget.requester?.name ?? "this viewer"}`}
          confirmLabel="Reject request"
          onClose={() => setRejectTarget(null)}
          onConfirm={async () => {
            const result = await decideDownloadRequestAction(rejectTarget.id, false, rejectNote);
            if (!result.error) setRejectTarget(null);
            return result;
          }}
        >
          <div className="dialog-body">
            <div className="field">
              <label>Reason (shown to the requester)</label>
              <textarea className="input" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
