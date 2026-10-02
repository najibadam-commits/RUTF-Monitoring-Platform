"use client";

import { useState } from "react";
import { DownloadRequestStatusTag } from "@/components/ui/Tags";
import { fetchApprovedDownloadAction } from "@/lib/actions/downloadRequests";
import type { DownloadRequestRow } from "@/lib/queries/downloadRequests";

function filtersSummary(filters: unknown): string {
  if (!filters || typeof filters !== "object") return "—";
  const entries = Object.entries(filters as Record<string, unknown>).filter(([, v]) => v);
  if (entries.length === 0) return "All issues (no filters)";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

export function MyDownloadRequests({ requests }: { requests: DownloadRequestRow[] }) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(r: DownloadRequestRow) {
    if (!r.download_token) return;
    setDownloadingId(r.id);
    setError(null);
    const result = await fetchApprovedDownloadAction(r.id, r.download_token);
    setDownloadingId(null);
    if (result.error || !result.content) {
      setError(result.error ?? "Download failed.");
      return;
    }
    const blob = new Blob([result.content], { type: result.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename ?? "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>My Download Requests</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Every export you request needs Super Admin approval before it can be downloaded.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
          {error}
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Resource</th>
              <th>Filters / Scope</th>
              <th>Reason</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="text-muted">{new Date(r.created_at).toLocaleString()}</td>
                <td className="text-muted">
                  {r.resource_type} · {r.format.toUpperCase()}
                </td>
                <td className="text-muted" style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={filtersSummary(r.filters)}>
                  {filtersSummary(r.filters)}
                </td>
                <td className="text-muted" style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.reason ?? undefined}>
                  {r.reason || "—"}
                </td>
                <td>
                  <DownloadRequestStatusTag status={r.status} />
                  {r.status === "rejected" && r.review_note && (
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {r.review_note}
                    </div>
                  )}
                </td>
                <td>
                  {r.status === "approved" && r.download_token && (
                    <button className="btn btn-secondary" disabled={downloadingId === r.id} onClick={() => handleDownload(r)}>
                      <i className={downloadingId === r.id ? "ph ph-circle-notch spin" : "ph ph-download-simple"} />
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  You haven&apos;t requested any downloads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
