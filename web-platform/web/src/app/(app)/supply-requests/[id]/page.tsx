import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { canAccessSupplyRequests } from "@/lib/rbac";
import { SUPPLY_STATUS } from "@/components/supply/supplyStatus";
import { SupplyRequestActions, type SupplyDetail } from "@/components/supply/SupplyRequestActions";
import { NeedCalculation } from "@/components/supply/NeedCalculation";

export const metadata: Metadata = { title: "Supply request" };

// One supply request (DECISIONS R170): who asked whom, for what (with the balance and use at the
// time), the decision and approved quantity, the transfers that dispatched it, and every step with
// who, when and why. The actions shown are the ones supply_request_get says the user may take.

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-GB"));
const fmtTime = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const EVENT: Record<string, string> = {
  submitted: "Submitted", review_started: "Review started", queried: "Queried", responded: "Answered — resubmitted", approved: "Approved",
  rejected: "Rejected", cancelled: "Cancelled", comment: "Comment", dispatched: "Dispatched (stock issued)", received: "Received (receipt recorded)",
};
const TRANSFER: Record<string, string> = { in_transit: "In transit", received: "Received in full", discrepancy: "Received with a discrepancy", cancelled: "Cancelled" };

export default async function SupplyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (!canAccessSupplyRequests(profile.role, level)) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supply_request_get", { p_id: id });
  if (error || !data) notFound();
  const d = data as unknown as SupplyDetail;
  const r = d.request;
  const st = SUPPLY_STATUS[r.status] ?? { label: r.status, colour: "var(--color-neutral-600)" };
  const requested = d.lines.reduce((a, l) => a + (l.requested_qty ?? 0), 0);
  const approved = d.lines.some((l) => l.approved_qty !== null) ? d.lines.reduce((a, l) => a + (l.approved_qty ?? 0), 0) : null;
  const sent = d.transfers.reduce((a, t) => a + (t.sachets_issued ?? 0), 0);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link href="/supply-requests" style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> Supply Requests</Link>
        <h2 style={{ margin: "6px 0 2px" }}>{r.code}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {r.level === "lga_to_state" ? "LGA store → State store" : "OTP site → LGA store"} · <span style={{ color: st.colour, fontWeight: 600 }}>● {st.label}</span>
          {" "}· asked by {r.requested_by_name ?? "—"} on {fmtTime(r.submitted_at)}
          {r.reviewed_by_name ? ` · reviewed by ${r.reviewed_by_name}` : ""}
        </p>
      </div>

      <div className="kpi-row">
        <div className="card elev-sm kpi-card"><div className="kpi-label">From</div><div style={{ fontWeight: 600 }}>{r.from_name}</div><div className="kpi-sub">{r.from_lga} LGA</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">To</div><div style={{ fontWeight: 600 }}>{r.to_name}</div>
          <div className="kpi-sub">{d.supplier_balance !== null && d.supplier_balance !== undefined ? `${fmt(d.supplier_balance)} sachets in stock now` : "Supplying store"}</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Asked</div><div className="kpi-value">{fmt(requested)}</div><div className="kpi-sub">Sachets{r.needed_by ? ` · needed by ${new Date(r.needed_by).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Approved</div><div className="kpi-value">{fmt(approved)}</div><div className="kpi-sub">{r.decision_note ?? (approved === null ? "No decision yet" : "As asked")}</div></div>
        <div className="card elev-sm kpi-card"><div className="kpi-label">Sent</div><div className="kpi-value">{fmt(sent)}</div><div className="kpi-sub">{d.transfers.length} transfer{d.transfers.length === 1 ? "" : "s"}</div></div>
      </div>

      <SupplyRequestActions detail={d} />

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div className="card-title">Commodities</div>
        <table className="table">
          <thead><tr><th>Commodity</th><th style={{ textAlign: "right" }}>Balance when asked</th><th style={{ textAlign: "right" }}>Used, last 30 days</th><th style={{ textAlign: "right" }}>Days out of stock</th><th style={{ textAlign: "right" }}>Asked</th><th style={{ textAlign: "right" }}>Approved</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.product_id}>
                <td>{l.product}</td>
                <td style={{ textAlign: "right" }}>{fmt(l.balance_on_hand)}</td>
                <td style={{ textAlign: "right" }}>{fmt(l.consumed_30d)}</td>
                <td style={{ textAlign: "right" }}>{fmt(l.stockout_days)}</td>
                <td style={{ textAlign: "right" }}><b>{fmt(l.requested_qty)}</b><div className="text-muted" style={{ fontSize: 12 }}>{(l.requested_qty / l.units_per_carton).toLocaleString("en-GB", { maximumFractionDigits: 1 })} cartons</div></td>
                <td style={{ textAlign: "right" }}>{fmt(l.approved_qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.justification && <div style={{ fontSize: 13 }}><span className="text-muted">Why: </span>{r.justification}</div>}
      </div>

      {/* The figures the request was based on, as saved when it was made (R173). */}
      {r.calculation && <NeedCalculation calc={r.calculation} asked={requested} />}

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div className="card-title">Dispatch</div>
        {d.transfers.length === 0
          ? <div className="text-muted" style={{ fontSize: 13 }}>
              {["approved", "partially_fulfilled"].includes(r.status)
                ? "Approved, not yet sent. The supplying store records the issue as usual (Issue Stock in the app); the transfer is linked to this request automatically."
                : "Nothing sent. Stock moves only when the supplying store records the issue."}
            </div>
          : (
            <table className="table">
              <thead><tr><th>Transfer</th><th>Issued</th><th style={{ textAlign: "right" }}>Sachets sent</th><th style={{ textAlign: "right" }}>Received</th><th>Status</th></tr></thead>
              <tbody>
                {d.transfers.map((t) => (
                  <tr key={t.id}><td>{t.code}</td><td>{new Date(t.issued_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td style={{ textAlign: "right" }}>{fmt(t.sachets_issued)}</td><td style={{ textAlign: "right" }}>{fmt(t.sachets_received)}</td><td>{TRANSFER[t.status] ?? t.status}</td></tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div className="card elev-sm" style={{ gap: 8 }}>
        <div className="card-title">History</div>
        <table className="table">
          <thead><tr><th>When</th><th>Step</th><th>By</th><th>Note</th></tr></thead>
          <tbody>
            {d.events.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtTime(e.at)}</td>
                <td>{EVENT[e.action] ?? e.action}</td>
                <td>{e.actor ?? "—"}{e.actor_role ? <div className="text-muted" style={{ fontSize: 12 }}>{e.actor_role}</div> : null}</td>
                <td style={{ fontSize: 13 }}>
                  {e.note ?? ""}
                  {e.action === "approved" && e.detail?.approved ? <div className="text-muted" style={{ fontSize: 12 }}>Approved {fmt(e.detail.approved.reduce((a: number, x: { approved_qty: number }) => a + x.approved_qty, 0))} of {fmt(e.detail.requested.reduce((a: number, x: { requested_qty: number }) => a + x.requested_qty, 0))} sachets</div> : null}
                  {e.action === "responded" && e.detail?.after ? <div className="text-muted" style={{ fontSize: 12 }}>Quantity changed to {fmt(e.detail.after.reduce((a: number, x: { requested_qty: number }) => a + x.requested_qty, 0))} sachets</div> : null}
                  {e.action === "dispatched" && e.detail ? <div className="text-muted" style={{ fontSize: 12 }}>{fmt(e.detail.sachets)} sachets on {e.detail.transfer_code}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
