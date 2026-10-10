"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { decideWeeklyReportAction, startWeeklyReportReviewAction } from "@/lib/actions/weeklyReports";

type Decision = "approved" | "returned" | "rejected";

const TITLE: Record<Decision, string> = { approved: "Approve the weekly report", returned: "Return for correction", rejected: "Reject the weekly report" };
const CONFIRM: Record<Decision, string> = { approved: "Approve", returned: "Return", rejected: "Reject" };
const LABEL: Record<Decision, string> = { approved: "Comment (optional)", returned: "What needs correcting?", rejected: "Why is the report rejected?" };

/** The State Coordinator's decision on a submitted weekly report: approve, return with what needs
 *  correcting, or reject with the reason (both required). Opening the report marks it "under
 *  review". The database records each step against the coordinator's account. */
export function WeeklyReportDecision({ reportId, unexplainedBlocking, startReview }: { reportId: string; unexplainedBlocking: number; startReview: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const started = useRef(false);

  // A submitted report the coordinator opens becomes "under review" (once).
  useEffect(() => {
    if (!startReview || started.current) return;
    started.current = true;
    startWeeklyReportReviewAction(reportId).then((r) => { if (!r.error) router.refresh(); });
  }, [startReview, reportId, router]);

  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--stage-addressing)" }}>
      <div className="card-title">Your decision</div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Check the caseload reconciliation, the stock movements, any corrected figures and the officer&apos;s explanations, then approve the report,
        return it with what needs correcting, or reject it. A rejected report can only come back as a new version.
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
          <i className="ph ph-arrow-u-up-left" /> Return for correction
        </button>
        <button className="btn btn-ghost" onClick={() => { setMode("rejected"); setNote(""); }}>
          <i className="ph ph-x-circle" /> Reject
        </button>
      </div>
      {mode && (
        <Modal
          title={TITLE[mode]}
          confirmLabel={CONFIRM[mode]}
          confirmDisabled={mode !== "approved" && !note.trim()}
          onClose={() => setMode(null)}
          onConfirm={async () => {
            const r = await decideWeeklyReportAction(reportId, mode, note);
            if (!r.error) router.refresh();
            return r;
          }}
        >
          <div className="dialog-body">
            <div className="field">
              <label>{LABEL[mode]}</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={mode === "approved" ? "Anything to note for the OTP Officer…" : "Be specific: the section, the figure, what to check…"} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
