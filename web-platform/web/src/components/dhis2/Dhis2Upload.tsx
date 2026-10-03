"use client";

import { useState, useTransition } from "react";
import { uploadDhis2Action } from "@/lib/actions/dhis2";

// Admin upload of a DHIS2 monthly RUTF extract (CSV). Rows are matched by facility and month,
// so re-uploading a corrected extract replaces the earlier figures.

export function Dhis2Upload() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="card elev-sm"
      style={{ padding: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      action={(fd) =>
        start(async () => {
          const r = await uploadDhis2Action(fd);
          setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `${r.loaded} facility-months loaded.` });
        })
      }
    >
      <div style={{ fontSize: 13, flex: "1 1 320px" }}>
        <strong>Upload a DHIS2 extract</strong>
        <div className="text-muted" style={{ fontSize: 12 }}>
          CSV with facility_id, period (YYYYMM), rutf_sachets_received, rutf_sachets_distributed, rutf_sachets_wasted and
          rutf_stockout_days; otp_admissions is optional. A facility-month already loaded is replaced.
        </div>
      </div>
      <input type="file" name="file" accept=".csv,text/csv" required className="input" style={{ maxWidth: 280 }} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        <i className="ph ph-upload-simple" /> {pending ? "Uploading…" : "Upload"}
      </button>
      {msg && (
        <span role="status" style={{ fontSize: 13, color: msg.ok ? "inherit" : "var(--priority-critical)" }}>
          <i className={`ph ${msg.ok ? "ph-check-circle" : "ph-warning-circle"}`} /> {msg.text}
        </span>
      )}
    </form>
  );
}
