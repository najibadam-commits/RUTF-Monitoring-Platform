"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { reviewReportAction, startReviewAction, type ReportKind, type ReviewAction } from "@/lib/actions/reportReview";

const TITLE: Record<ReviewAction, string> = { accept: "Accept the report", return: "Return for correction", reject: "Reject the report", query: "Query the report" };
const CONFIRM: Record<ReviewAction, string> = { accept: "Accept", return: "Return", reject: "Reject", query: "Send the query" };
const LABEL: Record<ReviewAction, string> = {
  accept: "Comment (optional)", return: "What needs correcting?", reject: "Why is the report rejected?", query: "Your question",
};
const HINT: Record<ReviewAction, string> = {
  accept: "Anything to note for the officer…",
  return: "Be specific: the section, the figure, what to check…",
  reject: "The reason, so a new version can put it right…",
  query: "What needs explaining? The officer answers without changing the figures…",
};

/** The reviewer's actions on a weekly report (DECISIONS R171). Only the buttons the database will
 *  allow are shown: accept and reject for the reviewer (the LGA Nutrition Officer for an OTP report,
 *  the State Nutrition Officer for an LGA report), query and return also for the State
 *  Coordinator (technical oversight). Opening a submitted report marks it "under review". */
export function ReviewPanel({ kind, id, canAccept, canReturn, canQuery, startReview, unexplainedBlocking = 0, intro }: {
  kind: ReportKind; id: string; canAccept: boolean; canReturn: boolean; canQuery: boolean; startReview: boolean; unexplainedBlocking?: number; intro: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ReviewAction | null>(null);
  const [note, setNote] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!startReview || started.current) return;
    started.current = true;
    startReviewAction(kind, id).then((r) => { if (!r.error) router.refresh(); });
  }, [startReview, kind, id, router]);

  const open = (m: ReviewAction) => { setMode(m); setNote(""); };
  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--stage-addressing)" }}>
      <div className="card-title">{canAccept ? "Your decision" : "Technical oversight"}</div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{intro}</p>
      {canAccept && unexplainedBlocking > 0 && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--priority-critical)" }}>
          {unexplainedBlocking} flagged issue{unexplainedBlocking === 1 ? " has" : "s have"} no explanation: query or return the report.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canAccept && (
          <button className="btn btn-primary" disabled={unexplainedBlocking > 0} onClick={() => open("accept")}>
            <i className="ph ph-check-circle" /> Accept
          </button>
        )}
        {canQuery && <button className="btn btn-secondary" onClick={() => open("query")}><i className="ph ph-question" /> Query</button>}
        {canReturn && <button className="btn btn-secondary" onClick={() => open("return")}><i className="ph ph-arrow-u-up-left" /> Return for correction</button>}
        {canAccept && <button className="btn btn-ghost" onClick={() => open("reject")}><i className="ph ph-x-circle" /> Reject</button>}
      </div>
      {mode && (
        <Modal
          title={TITLE[mode]}
          confirmLabel={CONFIRM[mode]}
          confirmDisabled={mode !== "accept" && !note.trim()}
          onClose={() => setMode(null)}
          onConfirm={async () => {
            const r = await reviewReportAction(kind, id, mode, note);
            if (!r.error) router.refresh();
            return r;
          }}
        >
          <div className="dialog-body">
            <div className="field">
              <label>{LABEL[mode]}</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={HINT[mode]} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export type ReportEvent = { version: number | null; action: string; actor: string | null; actor_role: string | null; note: string | null; status_before: string | null; status_after: string | null; at: string };

const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted", review_started: "Review started", queried: "Queried", answered: "Query answered — resubmitted", returned: "Returned for correction",
  accepted: "Accepted", rejected: "Rejected", reopened: "Reopened for amendment", comment: "Comment",
};

/** The report's history: every step, who (and in which role), when, and the note. */
export function ReportHistory({ events }: { events: ReportEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="card elev-sm" style={{ gap: 8 }}>
      <div className="card-title">Review history</div>
      <table className="table">
        <thead><tr><th>When</th><th>Step</th><th>By</th><th>Note</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</td>
              <td>{EVENT_LABEL[e.action] ?? e.action}{e.version ? <span className="text-muted"> · v{e.version}</span> : null}</td>
              <td>{e.actor ?? "—"}{e.actor_role ? <div className="text-muted" style={{ fontSize: 12 }}>{e.actor_role}</div> : null}</td>
              <td style={{ fontSize: 13 }}>{e.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The open query, shown at the top while the report waits for the answer. */
export function OpenQuery({ query, waitingFor }: { query: { note: string; by: string | null; role: string | null; at: string } | null; waitingFor: string }) {
  if (!query) return null;
  return (
    <div className="card elev-sm" style={{ gap: 6, borderLeft: "4px solid var(--priority-high)" }}>
      <div className="card-title"><i className="ph ph-question" /> Queried — waiting for {waitingFor}</div>
      <div style={{ fontSize: 14 }}>&ldquo;{query.note}&rdquo;</div>
      <div className="kpi-sub">{query.by ?? "—"}{query.role ? ` (${query.role})` : ""} · {new Date(query.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</div>
    </div>
  );
}
