"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidLedgerEntryAction, type VoidResult } from "@/lib/actions/stock";

// Stock Ledger: void one submission (all the rows it wrote) with a reason. Opens inline; the
// entry stays visible, struck through, with who voided it and why.

const KIND: Record<string, string> = {
  receipt: "receipt",
  issue: "issue",
  dispensing: "day's dispensing",
  stock_count: "stock count",
  loss: "loss / adjustment",
};

export function VoidEntryButton({ localId, label }: { localId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VoidResult | null>(null);

  if (result && !result.error) {
    return (
      <div role="status" style={{ fontSize: 12, maxWidth: 260, whiteSpace: "normal" }}>
        <i className="ph ph-check-circle" aria-hidden="true" /> {result.duplicate ? "Already voided." : `Voided the ${KIND[result.kind ?? ""] ?? "entry"}.`}
        {result.transferStatus === "in_transit" && <div>Transfer {result.transferCode} is back in transit.</div>}
        {result.transferStatus === "cancelled" && <div>Transfer {result.transferCode} is cancelled.</div>}
        {!!result.lotsBelowZero && (
          <div style={{ color: "var(--priority-high)" }}>
            <i className="ph-fill ph-warning" aria-hidden="true" /> {result.lotsBelowZero} lot{result.lotsBelowZero === 1 ? " is" : "s are"} now below zero — record a stock count to correct.
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setOpen(true)}>
        <i className="ph ph-prohibit" aria-hidden="true" /> Void
      </button>
    );
  }

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240, whiteSpace: "normal" }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await voidLedgerEntryAction(localId, reason);
          setResult(r);
          if (!r.error) router.refresh();
        });
      }}
    >
      <label style={{ fontSize: 12 }}>
        Void the {label} and every line recorded with it. Why?
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={10}
          placeholder="e.g. entered twice — duplicate of the 3 Sept receipt" style={{ width: "100%", marginTop: 4 }} />
      </label>
      {result?.error && <span role="alert" style={{ fontSize: 12, color: "var(--priority-critical)" }}>{result.error}</span>}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-primary" type="submit" disabled={pending || reason.trim().length < 10} style={{ fontSize: 12, padding: "4px 10px" }}>
          {pending ? "Voiding…" : "Void entry"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => { setOpen(false); setResult(null); }} style={{ fontSize: 12, padding: "4px 10px" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
