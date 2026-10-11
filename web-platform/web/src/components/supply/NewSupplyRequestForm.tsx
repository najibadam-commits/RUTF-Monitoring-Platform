"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupplyRequestAction } from "@/lib/actions/supplyRequests";
import type { Calculation } from "@/components/supply/NeedCalculation";

export type SupplyForm = {
  facility: { id: string; name: string; type: string };
  supplier: { id: string; name: string; type: string };
  level: "otp_to_lga" | "lga_to_state";
  balance_on_hand: number;
  consumed_30d: number;
  products: { id: string; name: string; unit: string; units_per_carton: number }[];
  open_requests: number;
  calculation?: Calculation;
};

const fmt = (n: number) => n.toLocaleString("en-GB");

/** The request form: per commodity the quantity (cartons or sachets, stored as sachets) and days
 *  out of stock; the balance on hand and the last 30 days' use are shown from the ledger and saved
 *  with the request. */
export function NewSupplyRequestForm({ form }: { form: SupplyForm }) {
  const router = useRouter();
  // The calculated suggestion fills the first commodity (RUTF), in cartons (R173).
  const suggested = form.calculation?.suggested_qty ?? null;
  const first = form.products[0];
  const [qty, setQty] = useState<Record<string, string>>(
    suggested !== null && first ? { [first.id]: String(Math.ceil(suggested / first.units_per_carton)) } : {});
  const [unit, setUnit] = useState<Record<string, "carton" | "sachet">>({});
  const [stockout, setStockout] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One id per form, so a double click or a retried submission creates one request.
  const localId = useMemo(() => `WEB-SR-${crypto.randomUUID()}`, []);

  const sachets = (p: SupplyForm["products"][number]) => {
    const n = Number(qty[p.id] ?? 0);
    return (unit[p.id] ?? "carton") === "carton" ? n * p.units_per_carton : n;
  };
  const monthsCover = form.consumed_30d > 0 ? form.balance_on_hand / form.consumed_30d : null;
  const lines = form.products.map((p) => ({ product_id: p.id, requested_qty: sachets(p), stockout_days: stockout[p.id] ? Number(stockout[p.id]) : null })).filter((l) => l.requested_qty > 0);
  const total = lines.reduce((a, l) => a + l.requested_qty, 0);
  const differs = suggested !== null && total !== suggested;

  async function submit() {
    setPending(true); setError(null);
    const r = await createSupplyRequestAction({ lines, justification, needed_by: neededBy || null, local_id: localId });
    setPending(false);
    if (r.error) { setError(r.error); return; }
    router.push(`/supply-requests/${r.id}`);
  }

  return (
    <>
      <div className="kpi-row">
        <div className="card elev-sm kpi-card"><div className="kpi-label">From</div><div style={{ fontWeight: 600 }}>{form.facility.name}</div><div className="kpi-sub">Your store</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">To</div><div style={{ fontWeight: 600 }}>{form.supplier.name}</div><div className="kpi-sub">Reviewed by the State Nutrition Officer</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Balance on hand</div><div className="kpi-value">{fmt(form.balance_on_hand)}</div><div className="kpi-sub">Sachets, from the stock ledger</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Issued in the last 30 days</div><div className="kpi-value">{fmt(form.consumed_30d)}</div>
          <div className="kpi-sub">{monthsCover === null ? "No issues recorded" : `About ${monthsCover.toLocaleString("en-GB", { maximumFractionDigits: 1 })} months of stock left`}</div></div>
      </div>
      {form.open_requests > 0 && (
        <div className="card elev-sm" style={{ borderLeft: "4px solid var(--priority-high)", fontSize: 13 }}>
          You already have {form.open_requests} request{form.open_requests === 1 ? "" : "s"} open. <Link href="/supply-requests?box=outgoing">See them</Link> before asking again.
        </div>
      )}
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div className="card-title">What you need</div>
        <table className="table">
          <thead><tr><th>Commodity</th><th>Quantity</th><th>Unit</th><th style={{ textAlign: "right" }}>Sachets</th><th>Days out of stock (last 30)</th></tr></thead>
          <tbody>
            {form.products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}<div className="text-muted" style={{ fontSize: 12 }}>{p.units_per_carton} {p.unit}s a carton</div></td>
                <td><input className="input" type="number" min={0} inputMode="numeric" style={{ maxWidth: 120 }} value={qty[p.id] ?? ""} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} aria-label={`Quantity of ${p.name}`} /></td>
                <td>
                  <select className="input" style={{ maxWidth: 120 }} value={unit[p.id] ?? "carton"} onChange={(e) => setUnit({ ...unit, [p.id]: e.target.value as "carton" | "sachet" })} aria-label="Unit">
                    <option value="carton">Cartons</option><option value="sachet">Sachets</option>
                  </select>
                </td>
                <td style={{ textAlign: "right" }}><b>{fmt(sachets(p))}</b></td>
                <td><input className="input" type="number" min={0} max={30} style={{ maxWidth: 100 }} value={stockout[p.id] ?? ""} onChange={(e) => setStockout({ ...stockout, [p.id]: e.target.value })} aria-label="Days out of stock" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
          <div className="field">
            <label>Needed by (optional)</label>
            <input className="input" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          {suggested !== null && (
            <div style={{ gridColumn: "1 / -1", fontSize: 13 }}>
              Suggested from the calculation below: <b>{suggested.toLocaleString("en-GB")} sachets</b>
              {suggested === 0 ? " — the usable stock already covers the need." : ""}
              {differs ? <span style={{ color: "var(--priority-high)" }}> · you are asking for {total.toLocaleString("en-GB")}: say why below.</span> : null}
            </div>
          )}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Why this quantity{differs ? " (required: it differs from the suggestion)" : ""}</label>
            <textarea className="input" value={justification} onChange={(e) => setJustification(e.target.value)}
              placeholder="Caseload, consumption, stock-outs at OTP sites, distance, the next delivery…" />
          </div>
        </div>
        {error && <div role="alert" style={{ color: "var(--priority-critical)", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={pending || lines.length === 0 || (differs && !justification.trim())} onClick={submit}><i className="ph ph-paper-plane-tilt" /> {pending ? "Sending…" : "Send to the State Nutrition Officer"}</button>
          <Link className="btn btn-secondary" href="/supply-requests">Cancel</Link>
        </div>
      </div>
    </>
  );
}
