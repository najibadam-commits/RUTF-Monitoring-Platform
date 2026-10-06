import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { facilityNames } from "@/lib/queries/stock";
import { tagBg } from "@/lib/constants";
import type { TransferStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Transfers" };

// Transfers (brief §9; DECISIONS R103): the chain of custody for every shipment State store -> LGA
// store -> OTP site — in transit, received in full, or received with a discrepancy — with the share
// delivered in full, sachets in transit and missing, status tiles that filter, and on each transfer
// the Finding it raised (transfer mismatch / receipt not confirmed). RLS scopes the rows (a facility
// user: transfers to or from their facility).

const PAGE_SIZE = 25;
const STATUS_META: Record<TransferStatus, { label: string; color: string }> = {
  in_transit: { label: "In transit", color: "var(--priority-high)" },
  received: { label: "Received in full", color: "var(--status-resolved)" },
  discrepancy: { label: "Discrepancy", color: "var(--priority-critical)" },
  cancelled: { label: "Cancelled (issue voided)", color: "var(--color-neutral-600)" },
};
const fmt = (n: number) => n.toLocaleString("en-GB");

type SP = Record<string, string | undefined>;
function hrefWith(sp: SP, patch: SP) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) params.set(k, v);
  const qs = params.toString();
  return `/transfers${qs ? `?${qs}` : ""}`;
}

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await getCurrentProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  // Days a transfer may stay in transit before "receipt not confirmed" (rutf_thresholds, brief §6).
  const { data: th } = await supabase.from("rutf_thresholds").select("value").eq("key", "receipt_confirm_days").limit(1).maybeSingle();
  const OVERDUE_DAYS = Number(th?.value ?? 7);
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  // Level of the shipment, by the sending facility.
  let fromIds: string[] | null = null;
  if (sp.level === "state" || sp.level === "lga") {
    const { data } = await supabase.from("facilities").select("id").eq("facility_type", sp.level === "state" ? "state_store" : "lga_store");
    fromIds = (data ?? []).map((f) => f.id);
  }

  let q = supabase.from("transfer_overview").select("*", { count: "exact" }).order("issued_date", { ascending: false }).order("code", { ascending: false });
  if (sp.transfer) q = q.eq("id", sp.transfer);
  if (sp.status === "overdue") q = q.eq("status", "in_transit").gt("days_in_transit", OVERDUE_DAYS);
  else if (sp.status) q = q.eq("status", sp.status as TransferStatus);
  if (sp.facility) q = q.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
  if (fromIds) q = q.in("from_facility_id", fromIds);
  if (sp.search?.trim()) q = q.ilike("code", `%${sp.search.trim().replace(/[%,()]/g, " ")}%`);

  const counts = async (build: (b: ReturnType<typeof base>) => ReturnType<typeof base>) => (await build(base())).count ?? 0;
  function base() {
    let b = supabase.from("transfer_overview").select("id", { count: "exact", head: true });
    if (sp.facility) b = b.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
    return b;
  }

  const [{ data, count }, inTransit, overdue, discrepancies, receivedFull, gapRows, transitRows] = await Promise.all([
    q.range(from, from + PAGE_SIZE - 1),
    counts((b) => b.eq("status", "in_transit")),
    counts((b) => b.eq("status", "in_transit").gt("days_in_transit", OVERDUE_DAYS)),
    counts((b) => b.eq("status", "discrepancy")),
    counts((b) => b.eq("status", "received")),
    (() => {
      let g = supabase.from("transfer_overview").select("gap").eq("status", "discrepancy");
      if (sp.facility) g = g.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
      return g.limit(1000);
    })(),
    (() => {
      let g = supabase.from("transfer_overview").select("sachets_issued").eq("status", "in_transit");
      if (sp.facility) g = g.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
      return g.limit(1000);
    })(),
  ]);
  const rows = data ?? [];
  const sachetsInTransit = (transitRows.data ?? []).reduce((n, r) => n + r.sachets_issued, 0);
  const delivered = receivedFull + discrepancies;
  const inFullPct = delivered ? (receivedFull * 100) / delivered : null;
  // The Finding each transfer on this page raised (transfer mismatch / receipt not confirmed).
  const { data: raised } = rows.length
    ? await supabase.from("issues").select("id, code, transfer_id").in("transfer_id", rows.map((r) => r.id))
    : { data: [] };
  const findingOf = Object.fromEntries((raised ?? []).filter((f) => f.transfer_id).map((f) => [f.transfer_id!, f]));
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const missingSachets = (gapRows.data ?? []).reduce((n, r) => n + r.gap, 0);
  const names = await facilityNames(supabase, [sp.facility, ...rows.flatMap((r) => [r.from_facility_id, r.to_facility_id])]);
  const filtered = !!(sp.status || sp.level || sp.search || sp.transfer);
  const off = { opacity: 0.45, pointerEvents: "none" as const };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Transfers</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          The chain of custody for every shipment, State store → LGA stores → OTP sites. The sender records the issue and the
          receiver confirms what arrived; each transfer has a traceable ID. A short delivery, or a receipt not confirmed within{" "}
          {OVERDUE_DAYS} days, raises a Finding automatically.
          {sp.facility && (
            <>
              {" "}Showing transfers to or from <strong>{names[sp.facility] ?? "this facility"}</strong> ·{" "}
              <Link href={hrefWith({ ...sp, facility: undefined, page: undefined }, {})}>show all</Link>
            </>
          )}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          { label: "Delivered in full", value: inFullPct === null ? "—" : `${inFullPct.toFixed(1)}%`, sub: `${fmt(receivedFull)} of ${fmt(delivered)} received`, status: "received", icon: "ph-check-circle", color: "var(--status-resolved)" },
          { label: "In transit", value: fmt(inTransit), sub: `${fmt(sachetsInTransit)} sachets on the road`, status: "in_transit", icon: "ph-truck", color: "var(--color-accent-600)" },
          { label: `Not confirmed in ${OVERDUE_DAYS} days`, value: fmt(overdue), sub: "Receipt not confirmed", status: "overdue", icon: "ph-hourglass-medium", color: overdue ? "var(--priority-high)" : "var(--status-resolved)" },
          { label: "Received with a discrepancy", value: fmt(discrepancies), sub: `${fmt(missingSachets)} sachets short`, status: "discrepancy", icon: "ph-warning", color: discrepancies ? "var(--priority-critical)" : "var(--status-resolved)" },
        ].map((k) => {
          const active = sp.status === k.status;
          return (
            <Link key={k.status} href={hrefWith({ facility: sp.facility }, active ? {} : { status: k.status })} className="card elev-sm" aria-pressed={active}
              title={active ? "Show every transfer" : `List: ${k.label.toLowerCase()}`}
              style={{ padding: 14, gap: 2, textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
                <i className={`ph-fill ${k.icon}`} aria-hidden="true" style={{ fontSize: 15, color: k.color }} /> {k.label}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 700 }}>{k.value}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>{active ? "Filtered · click to clear" : k.sub}</div>
            </Link>
          );
        })}
      </div>

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        {sp.facility && <input type="hidden" name="facility" defaultValue={sp.facility} />}
        <input className="input" name="search" placeholder="Transfer code…" defaultValue={sp.search ?? ""} style={{ maxWidth: 200 }} />
        <select className="input" name="status" defaultValue={sp.status ?? ""} style={{ maxWidth: 190 }}>
          <option value="">All statuses</option>
          <option value="in_transit">In transit</option>
          <option value="overdue">Not confirmed in {OVERDUE_DAYS} days</option>
          <option value="received">Received in full</option>
          <option value="discrepancy">Discrepancy</option>
        </select>
        <select className="input" name="level" defaultValue={sp.level ?? ""} style={{ maxWidth: 200 }}>
          <option value="">All levels</option>
          <option value="state">State store → LGA stores</option>
          <option value="lga">LGA stores → OTP sites</option>
        </select>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {filtered && <Link className="btn btn-secondary" href={hrefWith({ facility: sp.facility }, {})}><i className="ph ph-x-circle" /> Clear</Link>}
      </form>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Transfer</th>
              <th>From → To</th>
              <th>Issued</th>
              <th>Received</th>
              <th style={{ textAlign: "right" }}>Issued</th>
              <th style={{ textAlign: "right" }}>Received</th>
              <th style={{ textAlign: "right" }}>Gap</th>
              <th>Status</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const meta = STATUS_META[t.status];
              const late = t.status === "in_transit" && (t.days_in_transit ?? 0) > OVERDUE_DAYS;
              return (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                    {t.code}
                    {t.document_no && <div className="text-muted" style={{ fontSize: 11, fontWeight: 400 }}>{t.document_no}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    <Link href={`/stock-ledger?facility=${t.from_facility_id}`}>{names[t.from_facility_id] ?? "—"}</Link>
                    <span className="text-muted"> → </span>
                    <Link href={`/stock-ledger?facility=${t.to_facility_id}`}>{names[t.to_facility_id] ?? "—"}</Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{t.issued_date}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{t.received_date ?? <span className="text-muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>{fmt(t.sachets_issued)}</td>
                  <td style={{ textAlign: "right" }}>{t.sachets_received === null ? "—" : fmt(t.sachets_received)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: t.status === "discrepancy" ? "var(--priority-critical)" : undefined }}>
                    {t.status === "in_transit" ? "—" : fmt(t.gap)}
                  </td>
                  <td>
                    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>{meta.label}</span>
                    {t.status === "in_transit" && (
                      <div style={{ fontSize: 11, marginTop: 2, color: late ? "var(--priority-critical)" : "var(--color-neutral-600)" }}>
                        {t.days_in_transit} day{t.days_in_transit === 1 ? "" : "s"}{late ? " · not confirmed" : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                    {findingOf[t.id] ? <Link href={`/issues/${findingOf[t.id].id}`}>{findingOf[t.id].code}</Link> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-muted" style={{ textAlign: "center", padding: 24 }}>{filtered ? "No transfers match these filters." : "No transfers yet."}</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
          <span className="text-muted" style={{ fontSize: 12.5 }}>{fmt(total)} transfers — page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn btn-secondary" href={hrefWith(sp, { page: String(page - 1) })} style={page <= 1 ? off : undefined} aria-disabled={page <= 1}>Previous</Link>
            <Link className="btn btn-secondary" href={hrefWith(sp, { page: String(page + 1) })} style={page >= totalPages ? off : undefined} aria-disabled={page >= totalPages}>Next</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
