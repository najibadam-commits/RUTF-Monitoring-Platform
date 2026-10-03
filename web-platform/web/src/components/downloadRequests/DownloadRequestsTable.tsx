"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DownloadRequestStatusTag } from "@/components/ui/Tags";
import { decideDownloadRequestAction } from "@/lib/actions/downloadRequests";
import type { DownloadRequestRow } from "@/lib/queries/downloadRequests";
import { RESOURCE_LABEL, filtersSummary } from "@/lib/downloadResources";

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

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Data Access Requests</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          {pending.length} pending, {requests.length} total — every Viewer download requires approval here before it can be fetched.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
          {error}
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          Pending Review
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Requester</th>
              <th>Requested</th>
              <th>Resource</th>
              <th>Filters / Scope</th>
              <th>Reason</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id}>
                <td>{r.requester?.name ?? "—"}</td>
                <td className="text-muted">{new Date(r.created_at).toLocaleString()}</td>
                <td className="text-muted">
                  {RESOURCE_LABEL[r.resource_type] ?? r.resource_type} · {r.format.toUpperCase()}
                </td>
                <td className="text-muted" style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={filtersSummary(r.filters)}>
                  {filtersSummary(r.filters)}
                </td>
                <td className="text-muted" style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.reason ?? undefined}>
                  {r.reason || "—"}
                </td>
                <td>
                  <DownloadRequestStatusTag status={r.status} />
                </td>
                <td className="table-actions">
                  <button className="btn btn-icon btn-ghost" title="Approve" disabled={approvingId === r.id} onClick={() => handleApprove(r.id)}>
                    <i className={approvingId === r.id ? "ph ph-circle-notch spin" : "ph ph-check"} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="Reject"
                    onClick={() => {
                      setRejectNote("");
                      setRejectTarget(r);
                    }}
                  >
                    <i className="ph ph-x" />
                  </button>
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No pending requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          Decision History
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Requester</th>
              <th>Requested</th>
              <th>Resource</th>
              <th>Status</th>
              <th>Decided</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((r) => (
              <tr key={r.id}>
                <td>{r.requester?.name ?? "—"}</td>
                <td className="text-muted">{new Date(r.created_at).toLocaleString()}</td>
                <td className="text-muted">
                  {RESOURCE_LABEL[r.resource_type] ?? r.resource_type} · {r.format.toUpperCase()}
                </td>
                <td>
                  <DownloadRequestStatusTag status={r.status} />
                </td>
                <td className="text-muted">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : "—"}</td>
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
          confirmLabel="Reject Request"
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
