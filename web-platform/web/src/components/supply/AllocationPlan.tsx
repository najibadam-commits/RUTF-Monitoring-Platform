"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { issueAllocationAction, setApexAction } from "@/lib/actions/supplyRequests";
import type { SiteNeed } from "@/components/supply/NeedCalculation";

type Centre = SiteNeed & {
  suggested: number;
  approved_requests: { id: string; code: string; status: string; approved: number | null; sent: number }[];
};
export type Plan = {
  store: { id: string; name: string }; cover_days: number; store_usable: number; total_gap: number; scaled: boolean; sachets_per_carton: number;
  centres: Centre[]; has_apex: boolean; recent: { id: string; at: string; by: string; sachets: number; centres: number }[];
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));
const SOURCE: Record<string, string> = { registry: "Admission cards", "dispensing register": "Dispensing register", "last accepted weekly report": "Last weekly report", "no data": "No data" };

/** The allocation table: the suggested share per centre (editable, in cartons), the store's usable
 *  stock and what is left, open requests per centre, Apex marking, and Issue. */
export function AllocationPlan({ plan }: { plan: Plan }) {
  const router = useRouter();
  const per = plan.sachets_per_carton;
  const [cartons, setCartons] = useState<Record<string, string>>(
    Object.fromEntries(plan.centres.map((c) => [c.facility_id, String(Math.round(c.suggested / per))])));
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per plan, so a double click issues once; a new one after each distribution.
  const [localId, setLocalId] = useState(() => `WEB-ALLOC-${crypto.randomUUID()}`);

  const sachets = (id: string) => Math.max(0, Math.round(Number(cartons[id] || 0))) * per;
  const total = plan.centres.reduce((a, c) => a + sachets(c.facility_id), 0);
  const left = plan.store_usable - total;
  const lines = plan.centres.map((c) => ({ facility_id: c.facility_id, sachets: sachets(c.facility_id) })).filter((l) => l.sachets > 0);

  return (
    <>
      <div className="kpi-row">
        <div className="card elev-sm kpi-card"><div className="kpi-label">Usable stock in {plan.store.name}</div><div className="kpi-value">{n(plan.store_usable)}</div><div className="kpi-sub">Sachets, lots not expired</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Centres&apos; gaps</div><div className="kpi-value">{n(plan.total_gap)}</div>
          <div className="kpi-sub">{plan.scaled ? "More than the store holds: shares scaled down evenly" : `Need for ${plan.cover_days} days minus their stock`}</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">This plan</div><div className="kpi-value">{n(total)}</div><div className="kpi-sub">{n(total / per)} cartons</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Left in the store</div><div className="kpi-value" style={{ color: left < 0 ? "var(--priority-critical)" : undefined }}>{n(left)}</div><div className="kpi-sub">{left < 0 ? "More than the store holds" : "After this plan"}</div></div>
      </div>
      {!plan.has_apex && <div className="card elev-sm" style={{ borderLeft: "4px solid var(--priority-high)", fontSize: 13 }}>No Apex centre is set for this LGA: mark it in the table below.</div>}

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr>
            <th>OTP centre</th><th>Figures from</th><th style={{ textAlign: "right" }}>Patients</th><th style={{ textAlign: "right" }}>Need ({plan.cover_days} days)</th>
            <th style={{ textAlign: "right" }}>Usable stock</th><th style={{ textAlign: "right" }}>Gap</th><th style={{ textAlign: "right" }}>Suggested</th><th>Send (cartons)</th><th>Open requests</th>
          </tr></thead>
          <tbody>
            {plan.centres.map((c) => (
              <tr key={c.facility_id}>
                <td>
                  {c.facility}
                  {c.apex ? <span className="tag tag-accent" style={{ marginLeft: 6 }}>Apex</span>
                    : <button className="btn btn-ghost" style={{ padding: "0 6px", fontSize: 12 }} onClick={async () => {
                        const r = await setApexAction(c.facility_id); if (r.error) setError(r.error); else router.refresh();
                      }}>Make Apex</button>}
                </td>
                <td className="text-muted" style={{ fontSize: 12.5 }}>{SOURCE[c.source] ?? c.source}</td>
                <td style={{ textAlign: "right" }}>{n(c.patients)}</td><td style={{ textAlign: "right" }}>{n(c.need)}</td>
                <td style={{ textAlign: "right" }}>{n(c.usable_stock)}</td>
                <td style={{ textAlign: "right", color: c.gap > 0 ? "var(--priority-high)" : undefined }}>{n(c.gap)}</td>
                <td style={{ textAlign: "right" }}>{n(c.suggested)}</td>
                <td><input className="input" type="number" min={0} style={{ maxWidth: 90 }} value={cartons[c.facility_id] ?? ""} aria-label={`Cartons for ${c.facility}`}
                  onChange={(e) => setCartons({ ...cartons, [c.facility_id]: e.target.value })} /></td>
                <td style={{ fontSize: 12.5 }}>{c.approved_requests.length === 0 ? <span className="text-muted">—</span>
                  : c.approved_requests.map((r) => <div key={r.id}><Link href={`/supply-requests/${r.id}`}>{r.code}</Link> · {r.status.replace("_", " ")}{r.approved ? ` · ${n(r.approved)} approved` : ""}</div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
          <div className="field"><label>Waybill / document number (optional)</label><input className="input" value={doc} onChange={(e) => setDoc(e.target.value)} /></div>
          <div className="field"><label>Note (optional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why a share differs from the suggestion, the delivery route…" /></div>
        </div>
        {error && <div role="alert" style={{ color: "var(--priority-critical)", fontSize: 13 }}>{error}</div>}
        <div><button className="btn btn-primary" disabled={lines.length === 0 || left < 0} onClick={() => { setError(null); setConfirm(true); }}>
          <i className="ph ph-truck" /> Issue to {lines.length} centre{lines.length === 1 ? "" : "s"}
        </button></div>
      </div>

      {plan.recent.length > 0 && (
        <div className="card elev-sm" style={{ gap: 6 }}>
          <div className="card-title">Recent distributions</div>
          <table className="table"><tbody>
            {plan.recent.map((a) => <tr key={a.id}><td>{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</td>
              <td>{a.by}</td><td style={{ textAlign: "right" }}>{n(a.sachets)} sachets to {a.centres} centre{a.centres === 1 ? "" : "s"}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {confirm && (
        <Modal title="Issue the distribution" confirmLabel="Issue" onClose={() => setConfirm(false)} onConfirm={async () => {
          const r = await issueAllocationAction({ lines, note, document_no: doc, local_id: localId });
          if (!r.error) { setLocalId(`WEB-ALLOC-${crypto.randomUUID()}`); router.refresh(); }
          return r;
        }}>
          <div className="dialog-body" style={{ fontSize: 13 }}>
            <p>{n(total)} sachets ({n(total / per)} cartons) leave the store as {lines.length} stock issue{lines.length === 1 ? "" : "s"}, lots earliest expiry first.
              Each centre records the receipt when the RUTF arrives.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
