"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { decideWeeklyReportAction } from "@/lib/actions/weeklyReports";

/** The State Coordinator's decision on a submitted weekly report: approve, or return with what
 *  needs correcting (required). The database records it against the coordinator's account. */
export function WeeklyReportDecision({ reportId, unexplainedBlocking }: { reportId: string; unexplainedBlocking: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approved" | "returned" | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--stage-addressing)" }}>
      <div className="card-title">Your decision</div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Check the caseload reconciliation, the stock movements and the officer&apos;s explanations, then approve the report or return it with what needs correcting.
      </p>
      {unexplainedBlocking > 0 && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--priority-critical)" }}>
          {unexplainedBlocking} flagged issue{unexplainedBlocking === 1 ? " has" : "s have"} no explanation: return the report for correction.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={unexplainedBlocking > 0} onClick={() => { setMode("approved"); setNote(""); }}>
          <i className="ph ph-check-circle" /> Approve
        </button>
        <button className="btn btn-secondary" onClick={() => { setMode("returned"); setNote(""); }}>
          <i className="ph ph-arrow-u-up-left" /> Return for revision
        </button>
      </div>
      {mode && (
        <Modal
          title={mode === "approved" ? "Approve the weekly report" : "Return for revision"}
          confirmLabel={mode === "approved" ? "Approve" : "Return"}
          confirmDisabled={mode === "returned" && !note.trim()}
          onClose={() => setMode(null)}
          onConfirm={async () => {
            const r = await decideWeeklyReportAction(reportId, mode, note);
            if (!r.error) router.refresh();
            return r;
          }}
        >
          <div className="dialog-body">
            <div className="field">
              <label>{mode === "approved" ? "Comment (optional)" : "What needs correcting?"}</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={mode === "approved" ? "Anything to note for the OTP Officer…" : "Be specific: the section, the figure, what to check…"} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
