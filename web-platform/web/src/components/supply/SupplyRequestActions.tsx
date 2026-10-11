"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { actOnSupplyRequestAction } from "@/lib/actions/supplyRequests";

export type SupplyDetail = {
  request: {
    id: string; code: string; level: "otp_to_lga" | "lga_to_state"; status: string; submitted_at: string; needed_by: string | null; justification: string | null;
    decision_note: string | null; from_name: string; from_lga: string; to_name: string; requested_by_name: string | null; reviewed_by_name: string | null;
  };
  lines: { product_id: string; product: string; unit: string; units_per_carton: number; balance_on_hand: number | null; consumed_30d: number | null; stockout_days: number | null; requested_qty: number; approved_qty: number | null }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: { action: string; actor: string | null; actor_role: string | null; note: string | null; detail: any; at: string }[];
  transfers: { id: string; code: string; issued_date: string; sachets_issued: number; sachets_received: number | null; status: string }[];
  supplier_balance: number | null;
  can: { review: boolean; respond: boolean; cancel: boolean; comment: boolean; dispatch: boolean };
};

type Mode = "approve" | "query" | "reject" | "respond" | "cancel" | "comment";
const TITLE: Record<Mode, string> = {
  approve: "Approve the request", query: "Query the request", reject: "Reject the request", respond: "Answer the query", cancel: "Cancel the request", comment: "Add a comment",
};

/** What the user may do on this request (supply_request_get's `can`): the supplying store's
 *  officer approves (with the quantity per commodity; a different quantity needs the reason),
 *  queries or rejects; the requester answers a query (and may change the quantity) or cancels;
 *  either store, the State Coordinator and Supervisors comment. A submitted request the reviewer
 *  opens is marked "under review". */
export function SupplyRequestActions({ detail }: { detail: SupplyDetail }) {
  const router = useRouter();
  const r = detail.request;
  const [mode, setMode] = useState<Mode | null>(null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const started = useRef(false);

  useEffect(() => {
    if (!detail.can.review || r.status !== "submitted" || started.current) return;
    started.current = true;
    actOnSupplyRequestAction(r.id, "start_review", null, null).then((x) => { if (!x.error) router.refresh(); });
  }, [detail.can.review, r.status, r.id, router]);

  const anything = detail.can.review || detail.can.respond || detail.can.cancel || detail.can.comment || detail.can.dispatch;
  if (!anything) return null;

  const open = (m: Mode) => {
    setMode(m); setNote("");
    setQty(Object.fromEntries(detail.lines.map((l) => [l.product_id, String(m === "approve" ? (l.approved_qty ?? l.requested_qty) : l.requested_qty)])));
  };
  const differs = mode === "approve" && detail.lines.some((l) => Number(qty[l.product_id]) !== l.requested_qty);
  const needsNote = mode !== null && mode !== "cancel" && (mode !== "approve" || differs);

  async function confirm() {
    if (!mode) return {};
    const lines = mode === "approve" ? detail.lines.map((l) => ({ product_id: l.product_id, approved_qty: Number(qty[l.product_id] ?? 0) }))
      : mode === "respond" ? detail.lines.map((l) => ({ product_id: l.product_id, requested_qty: Number(qty[l.product_id] ?? l.requested_qty) }))
      : null;
    const x = await actOnSupplyRequestAction(r.id, mode, note || null, lines);
    if (!x.error) router.refresh();
    return x;
  }

  return (
    <div className="card elev-sm" style={{ gap: 10, borderLeft: "4px solid var(--stage-addressing)" }}>
      <div className="card-title">{detail.can.review ? "Your decision" : detail.can.respond ? "The reviewer has a question" : "Actions"}</div>
      {detail.can.review && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Check the balance and use at the requesting store against your own stock, then approve (you may approve less, with the reason), query, or
          reject. Approving moves no stock: record the issue afterwards as usual and it will be linked to this request.
        </p>
      )}
      {detail.can.respond && (
        <p style={{ fontSize: 13, margin: 0 }}>
          {[...detail.events].reverse().find((e) => e.action === "queried")?.note ?? "The request was queried."} — answer it to send the request back for review.
        </p>
      )}
      {detail.can.dispatch && (
        <p style={{ fontSize: 13, margin: 0 }}>
          {r.status === "partially_fulfilled"
            ? `Partly sent: ${detail.transfers.reduce((a, t) => a + t.sachets_issued, 0).toLocaleString("en-GB")} of ${detail.lines.reduce((a, l) => a + (l.approved_qty ?? 0), 0).toLocaleString("en-GB")} approved sachets. Record the issue of the rest`
            : "Approved. Record the issue"} to {r.from_name} in the app (Issue Stock); the transfer is linked to this request automatically.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {detail.can.review && <button className="btn btn-primary" onClick={() => open("approve")}><i className="ph ph-check-circle" /> Approve</button>}
        {detail.can.review && <button className="btn btn-secondary" onClick={() => open("query")}><i className="ph ph-question" /> Query</button>}
        {detail.can.review && <button className="btn btn-ghost" onClick={() => open("reject")}><i className="ph ph-x-circle" /> Reject</button>}
        {detail.can.respond && <button className="btn btn-primary" onClick={() => open("respond")}><i className="ph ph-chat-text" /> Answer the query</button>}
        {detail.can.cancel && <button className="btn btn-ghost" onClick={() => open("cancel")}><i className="ph ph-prohibit" /> Cancel the request</button>}
        {detail.can.comment && <button className="btn btn-secondary" onClick={() => open("comment")}><i className="ph ph-chat-circle" /> Comment</button>}
      </div>
      {mode && (
        <Modal title={TITLE[mode]} confirmLabel={mode === "cancel" ? "Cancel the request" : "Save"} confirmDisabled={needsNote && !note.trim()}
          onClose={() => setMode(null)} onConfirm={confirm}>
          <div className="dialog-body">
            {(mode === "approve" || mode === "respond") && detail.lines.map((l) => (
              <div className="field" key={l.product_id}>
                <label>{l.product}: sachets {mode === "approve" ? `to approve (asked ${l.requested_qty.toLocaleString("en-GB")})` : "asked"}</label>
                <input className="input" type="number" min={0} value={qty[l.product_id] ?? ""} onChange={(e) => setQty({ ...qty, [l.product_id]: e.target.value })} />
                <div className="kpi-sub">{(Number(qty[l.product_id] ?? 0) / l.units_per_carton).toLocaleString("en-GB", { maximumFractionDigits: 1 })} cartons</div>
              </div>
            ))}
            {mode !== "cancel" && (
              <div className="field">
                <label>{mode === "approve" ? (differs ? "Why a different quantity?" : "Comment (optional)") : mode === "query" ? "Your question"
                  : mode === "reject" ? "Why is it rejected?" : mode === "respond" ? "Your answer" : "Comment"}</label>
                <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            {mode === "cancel" && <p style={{ fontSize: 13 }}>The request is withdrawn; the supplying store is told.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
