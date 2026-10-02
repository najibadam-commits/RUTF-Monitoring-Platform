"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { requestDownloadAction } from "@/lib/actions/downloadRequests";

/** Viewer's stand-in for the direct "Export CSV" link on /issues (see issues/page.tsx) — every
 * Viewer download must go through Super Admin approval, so this creates a request instead of
 * downloading anything itself. Captures the page's current filters as the export's scope. */
export function RequestDownloadButton({ filters }: { filters: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [reason, setReason] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);

  return (
    <>
      <button
        className="btn btn-secondary"
        onClick={() => {
          setFormat("csv");
          setReason("");
          setOpen(true);
        }}
      >
        <i className="ph ph-download-simple" />
        Request Download
      </button>
      {justSubmitted && (
        <span className="text-muted" style={{ fontSize: 12, alignSelf: "center" }}>
          Request submitted for Super Admin approval.
        </span>
      )}

      {open && (
        <Modal
          title="Request Download"
          confirmLabel="Submit Request"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const result = await requestDownloadAction(format, filters, reason);
            if (!result.error) setJustSubmitted(true);
            return result;
          }}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
              Viewer downloads require Super Admin approval. This captures the current filters as
              the scope — track its status under Download Requests.
            </p>
            <div className="field">
              <label>Format</label>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div className="field">
              <label>Reason (optional)</label>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
