"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { lgaOfficerStepAction, openLgaReportAction, saveLgaCommentsAction, submitLgaReportAction } from "@/lib/actions/lgaReports";

/** "Prepare this week's LGA report": opens (or creates) the LGA Nutrition Officer's report. */
export function OpenLgaReportButton({ week }: { week: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <button className="btn btn-primary" disabled={pending} onClick={async () => {
        setPending(true); setError(null);
        const r = await openLgaReportAction(week);
        setPending(false);
        if (r.error) setError(r.error); else router.push(`/lga-reports/${r.id}`);
      }}><i className="ph ph-stack" /> {pending ? "Opening…" : "Prepare my LGA report for this week"}</button>
      {error && <div role="alert" style={{ color: "var(--priority-critical)", fontSize: 12.5 }}>{error}</div>}
    </div>
  );
}

/** The LGA Nutrition Officer's part: comments, then submit (with the comparison confirmed and, for
 *  an amendment, the reason); answer a query; reopen an accepted or rejected report. */
export function LgaOfficerPanel({ id, canEdit, canSubmit, canAnswer, canReopen, amendment, initialComments, weekOver, missingSites, pendingSites }: {
  id: string; canEdit: boolean; canSubmit: boolean; canAnswer: boolean; canReopen: boolean; amendment: boolean; initialComments: string;
  weekOver: boolean; missingSites: number; pendingSites: number;
}) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"answer" | "reopen" | null>(null);
  const [note, setNote] = useState("");

  if (!canEdit && !canAnswer && !canReopen) return null;
  const run = async (fn: () => Promise<{ error?: string }>, ok: string) => {
    setPending(true); setMsg(null);
    const r = await fn();
    setPending(false);
    if (r.error) setMsg({ error: r.error }); else { setMsg({ ok }); router.refresh(); }
  };

  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--color-accent)" }}>
      <div className="card-title">{canAnswer ? "The State has a question" : canReopen ? "Amend this report" : "Review and submit"}</div>
      {canEdit && (
        <>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Compare the combined figures with each OTP report below. Return any OTP report that is wrong from the Weekly OTP Reports page; once it is
            corrected and accepted again, this report recalculates. {pendingSites > 0 ? `${pendingSites} OTP report${pendingSites === 1 ? " is" : "s are"} still waiting for your review: finish those first. ` : ""}
            {missingSites > 0 ? `${missingSites} OTP site${missingSites === 1 ? " has" : "s have"} no accepted report: explain why in the comments.` : ""}
          </p>
          <div className="field">
            <label>Comments and explanations for the State</label>
            <textarea className="input" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Missing reports, stock movements, anything the State should know…" />
          </div>
          {amendment && (
            <div className="field">
              <label>Why is the report amended?</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center" }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have compared the combined figures with the OTP reports
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" disabled={pending} onClick={() => run(() => saveLgaCommentsAction(id, comments), "Comments saved.")}><i className="ph ph-floppy-disk" /> Save comments</button>
            <button className="btn btn-primary" disabled={pending || !canSubmit || !confirmed}
              onClick={() => run(() => submitLgaReportAction(id, comments, confirmed, amendment ? reason : null), "Submitted to the State Nutrition Officer.")}>
              <i className="ph ph-paper-plane-tilt" /> Submit to the State
            </button>
          </div>
          {!weekOver && <div className="kpi-sub">The week is not over yet: you can submit from the Monday after.</div>}
        </>
      )}
      {canAnswer && <button className="btn btn-primary" onClick={() => { setMode("answer"); setNote(""); }}><i className="ph ph-chat-text" /> Answer the query</button>}
      {canReopen && <button className="btn btn-secondary" onClick={() => { setMode("reopen"); setNote(""); }}><i className="ph ph-pencil-simple" /> Reopen for amendment</button>}
      {msg?.error && <div role="alert" style={{ color: "var(--priority-critical)", fontSize: 13 }}>{msg.error}</div>}
      {msg?.ok && <div style={{ color: "var(--status-resolved)", fontSize: 13 }}>{msg.ok}</div>}
      {mode && (
        <Modal title={mode === "answer" ? "Answer the query" : "Reopen the report for amendment"} confirmLabel={mode === "answer" ? "Send the answer" : "Reopen"}
          confirmDisabled={mode === "answer" && !note.trim()} onClose={() => setMode(null)}
          onConfirm={async () => { const r = await lgaOfficerStepAction(id, mode, note || null); if (!r.error) router.refresh(); return r; }}>
          <div className="dialog-body">
            {mode === "answer"
              ? <div className="field"><label>Your answer</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
              : <p style={{ fontSize: 13 }}>The report goes back to draft; the accepted version stays in the history and in the statewide report until the amendment is accepted.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
