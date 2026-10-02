import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { facilityNames } from "@/lib/queries/stock";
import { tagBg } from "@/lib/constants";
import type { TransferStatus } from "@/lib/types/database";

// Transfers (brief §9): every shipment State store -> LGA store -> OTP site, in transit,
// received, or received with a discrepancy. RLS scopes the rows (a facility user: transfers to
// or from their facility).

const PAGE_SIZE = 25;
const OVERDUE_DAYS = 7; // brief §6 receipt_not_confirmed default
const STATUS_META: Record<TransferStatus, { label: string; color: string }> = {
  in_transit: { label: "In transit", color: "var(--priority-high)" },
  received: { label: "Received", color: "var(--status-resolved)" },
  discrepancy: { label: "Discrepancy", color: "var(--priority-critical)" },
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

  const [{ data, count }, inTransit, overdue, discrepancies, gapRows] = await Promise.all([
    q.range(from, from + PAGE_SIZE - 1),
    counts((b) => b.eq("status", "in_transit")),
    counts((b) => b.eq("status", "in_transit").gt("days_in_transit", OVERDUE_DAYS)),
    counts((b) => b.eq("status", "discrepancy")),
    (() => {
      let g = supabase.from("transfer_overview").select("gap").eq("status", "discrepancy");
      if (sp.facility) g = g.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
      return g.limit(1000);
    })(),
  ]);
  const rows = data ?? [];
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
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Shipments from the State store to LGA stores, and from LGA stores to OTP sites.
          {sp.facility && (
            <>
              {" "}Showing transfers to or from <strong>{names[sp.facility] ?? "this facility"}</strong> ·{" "}
              <Link href={hrefWith({ ...sp, facility: undefined, page: undefined }, {})}>show all</Link>
            </>
          )}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {[
          { label: "In transit", value: inTransit, status: "in_transit" },
          { label: `In transit > ${OVERDUE_DAYS} days`, value: overdue, status: "overdue" },
          { label: "Received with a discrepancy", value: discrepancies, status: "discrepancy" },
        ].map((k) => (
          <Link key={k.status} href={hrefWith({ facility: sp.facility }, { status: k.status })} className="card elev-sm" style={{ padding: 14, textDecoration: "none", color: "inherit" }}>
            <div className="text-muted" style={{ fontSize: 12.5 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(k.value)}</div>
          </Link>
        ))}
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Sachets missing on receipt</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: missingSachets > 0 ? "var(--priority-critical)" : undefined }}>{fmt(missingSachets)}</div>
        </div>
      </div>

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        {sp.facility && <input type="hidden" name="facility" value={sp.facility} />}
        <input className="input" name="search" placeholder="Transfer code…" defaultValue={sp.search ?? ""} style={{ maxWidth: 200 }} />
        <select className="input" name="status" defaultValue={sp.status ?? ""} style={{ maxWidth: 190 }}>
          <option value="">All status</option>
          <option value="in_transit">In transit</option>
          <option value="overdue">In transit &gt; {OVERDUE_DAYS} days</option>
          <option value="received">Received</option>
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
                        {t.days_in_transit} day{t.days_in_transit === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 24 }}>{filtered ? "No transfers match these filters." : "No transfers yet."}</td></tr>
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
