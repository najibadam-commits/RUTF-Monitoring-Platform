"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadRequestStatusTag } from "@/components/ui/Tags";
import { fetchApprovedDownloadAction } from "@/lib/actions/downloadRequests";
import type { DownloadRequestRow } from "@/lib/queries/downloadRequests";
import { RESOURCE_LABEL } from "@/lib/downloadResources";
import { AccessSteps } from "@/components/downloadRequests/AccessSteps";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

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

  const ready = requests.filter((r) => r.status === "approved" && r.download_token);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>My Data Access Requests</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 760 }}>
            You can see every dashboard; to take data away, ask for an export and an administrator approves it. You are notified of the
            decision, and an approved file can be downloaded once.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-secondary" href="/reporting"><i className="ph ph-export" /> Request a monthly export</Link>
          <Link className="btn btn-secondary" href="/issues"><i className="ph ph-list-bullets" /> Request Findings</Link>
        </div>
      </div>

      <AccessSteps />

      {ready.length > 0 && (
        <div className="card elev-sm" style={{ padding: 14, gap: 4, borderLeft: "4px solid var(--status-resolved)" }}>
          <div style={{ fontWeight: 600 }}><i className="ph-fill ph-check-circle" aria-hidden="true" style={{ color: "var(--status-resolved)" }} /> {ready.length} {ready.length === 1 ? "file is" : "files are"} ready to download</div>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Each can be downloaded once; keep it secure and use it only for the reason you gave.</div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
          {error}
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  {RESOURCE_LABEL[r.resource_type] ?? r.resource_type} <span className="text-muted">· {r.format.toUpperCase()}</span>
                  <div className="text-muted" style={{ fontSize: 11.5, maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.scope}>{r.scope}</div>
                </td>
                <td className="text-muted" style={{ maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.reason ?? undefined}>
                  {r.reason || "—"}
                </td>
                <td className="text-muted">{when(r.created_at)}</td>
                <td>
                  <DownloadRequestStatusTag status={r.status} />
                  {r.status === "rejected" && r.review_note && (
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.review_note}</div>
                  )}
                  {r.status === "fulfilled" && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{when(r.fulfilled_at)}</div>}
                </td>
                <td>
                  {r.status === "approved" && r.download_token && (
                    <button className="btn btn-primary" disabled={downloadingId === r.id} onClick={() => handleDownload(r)}>
                      <i className={downloadingId === r.id ? "ph ph-circle-notch spin" : "ph ph-download-simple"} />
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  You haven&apos;t requested any data yet. Start from Programme Reporting or the Findings Register.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
