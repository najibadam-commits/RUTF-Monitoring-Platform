import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { facilityNames } from "@/lib/queries/stock";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { reportMonth } from "@/lib/queries/metrics";
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

  // Level of the shipment, by the sending facility; the two lanes below need both store lists.
  const [{ data: stateStores }, { data: lgaStores }, lgas, { data: lgaFacilities }] = await Promise.all([
    supabase.from("facilities").select("id").eq("facility_type", "state_store"),
    supabase.from("facilities").select("id").eq("facility_type", "lga_store"),
    getProgrammeLgas(supabase),
    sp.lga ? supabase.from("facilities").select("id").eq("lga_id", sp.lga) : Promise.resolve({ data: null }),
  ]);
  const stateIds = (stateStores ?? []).map((f) => f.id);
  const lgaStoreIds = (lgaStores ?? []).map((f) => f.id);
  const fromIds = sp.level === "state" ? stateIds : sp.level === "lga" ? lgaStoreIds : null;
  // LGA (DECISIONS R112): transfers to or from any facility in it.
  const lgaIds = sp.lga ? (lgaFacilities ?? []).map((f) => f.id) : null;
  const inLga = lgaIds?.length ? `from_facility_id.in.(${lgaIds.join(",")}),to_facility_id.in.(${lgaIds.join(",")})` : null;
  function scoped<T extends { or: (f: string) => T }>(b: T): T {
    let x = b;
    if (sp.facility) x = x.or(`from_facility_id.eq.${sp.facility},to_facility_id.eq.${sp.facility}`);
    if (inLga) x = x.or(inLga);
    return x;
  }

  let q = supabase.from("transfer_overview").select("*", { count: "exact" }).order("issued_date", { ascending: false }).order("code", { ascending: false });
  if (sp.transfer) q = q.eq("id", sp.transfer);
  if (sp.status === "overdue") q = q.eq("status", "in_transit").gt("days_in_transit", OVERDUE_DAYS);
  else if (sp.status) q = q.eq("status", sp.status as TransferStatus);
  q = scoped(q);
  if (fromIds) q = q.in("from_facility_id", fromIds);
  if (sp.search?.trim()) q = q.ilike("code", `%${sp.search.trim().replace(/[%,()]/g, " ")}%`);

  const counts = async (build: (b: ReturnType<typeof base>) => ReturnType<typeof base>) => (await build(base())).count ?? 0;
  function base() {
    return scoped(supabase.from("transfer_overview").select("id", { count: "exact", head: true }));
  }

  const [{ data, count }, inTransit, overdue, discrepancies, receivedFull, gapRows, transitRows] = await Promise.all([
    q.range(from, from + PAGE_SIZE - 1),
    counts((b) => b.eq("status", "in_transit")),
    counts((b) => b.eq("status", "in_transit").gt("days_in_transit", OVERDUE_DAYS)),
    counts((b) => b.eq("status", "discrepancy")),
    counts((b) => b.eq("status", "received")),
    (() => {
      return scoped(supabase.from("transfer_overview").select("gap").eq("status", "discrepancy")).limit(1000);
    })(),
    (() => {
      return scoped(supabase.from("transfer_overview").select("sachets_issued").eq("status", "in_transit")).limit(1000);
    })(),
  ]);
  const rows = data ?? [];
  // The two supply lanes in the latest month with ledger activity (as on the other report pages).
  const month = await reportMonth(supabase, undefined);
  const { data: recent } = await scoped(
    supabase.from("transfer_overview").select("status, gap, sachets_issued, issued_date, received_date, from_facility_id")
      .gte("issued_date", month.start).lte("issued_date", month.end),
  ).limit(5000);
  const lanes = [
    { key: "state", title: "State store → LGA stores", ids: new Set(stateIds) },
    { key: "lga", title: "LGA stores → OTP sites", ids: new Set(lgaStoreIds) },
  ].map((lane) => {
    const rs = (recent ?? []).filter((r) => lane.ids.has(r.from_facility_id) && r.status !== "cancelled");
    const done = rs.filter((r) => r.status === "received" || r.status === "discrepancy");
    const days = done.filter((r) => r.received_date).map((r) => Math.round((Date.parse(r.received_date!) - Date.parse(r.issued_date)) / 86_400_000)).sort((a, b) => a - b);
    return {
      ...lane,
      n: rs.length,
      sachets: rs.reduce((t, r) => t + r.sachets_issued, 0),
      inFull: done.length ? (done.filter((r) => r.status === "received").length * 100) / done.length : null,
      medianDays: days.length ? days[Math.floor((days.length - 1) / 2)] : null,
      short: done.filter((r) => r.status === "discrepancy").reduce((t, r) => t + r.gap, 0),
      inTransit: rs.filter((r) => r.status === "in_transit").length,
    };
  });
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
  const filtered = !!(sp.status || sp.level || sp.lga || sp.search || sp.transfer);
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

      <div className="kpi-row">
        {[
          { label: "Delivered in full", value: inFullPct === null ? "—" : `${inFullPct.toFixed(1)}%`, sub: `${fmt(receivedFull)} of ${fmt(delivered)} received`, status: "received", icon: "ph-check-circle", color: "var(--status-resolved)" },
          { label: "In transit", value: fmt(inTransit), sub: `${fmt(sachetsInTransit)} sachets on the road`, status: "in_transit", icon: "ph-truck", color: "var(--color-accent-600)" },
          { label: `Not confirmed in ${OVERDUE_DAYS} days`, value: fmt(overdue), sub: "Receipt not confirmed", status: "overdue", icon: "ph-hourglass-medium", color: overdue ? "var(--priority-high)" : "var(--status-resolved)" },
          { label: "Received with a discrepancy", value: fmt(discrepancies), sub: `${fmt(missingSachets)} sachets short`, status: "discrepancy", icon: "ph-warning", color: discrepancies ? "var(--priority-critical)" : "var(--status-resolved)" },
        ].map((k) => {
          const active = sp.status === k.status;
          return (
            <Link key={k.status} href={hrefWith({ facility: sp.facility }, active ? {} : { status: k.status })} className="card elev-sm kpi-card" aria-pressed={active}
              title={active ? "Show every transfer" : `List: ${k.label.toLowerCase()}`}
              style={{ textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div className="kpi-label">
                <i className={`ph-fill ${k.icon}`} aria-hidden="true" style={{ color: k.color }} /> {k.label}
              </div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-sub">{active ? "Filtered · click to clear" : k.sub}</div>
            </Link>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 12 }}>
        {lanes.map((l) => (
          <Link key={l.key} href={hrefWith({ facility: sp.facility, lga: sp.lga }, { level: sp.level === l.key ? undefined : l.key })} className="card elev-sm"
            aria-pressed={sp.level === l.key} title={sp.level === l.key ? "Show both lanes" : `List: ${l.title}`}
            style={{ padding: "10px 14px", gap: 6, textDecoration: "none", color: "inherit", outline: sp.level === l.key ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span className="card-title" style={{ fontSize: 13.5 }}><i className="ph ph-truck" aria-hidden="true" /> {l.title}</span>
              <span className="kpi-sub">issued in {month.label}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {[
                { label: "Transfers", value: fmt(l.n), sub: `${fmt(l.sachets)} sachets` },
                { label: "Delivered in full", value: l.inFull === null ? "—" : `${l.inFull.toFixed(1)}%`, sub: l.inTransit ? `${fmt(l.inTransit)} in transit` : "none in transit" },
                { label: "Median days in transit", value: l.medianDays === null ? "—" : String(l.medianDays), sub: "issue to receipt" },
                { label: "Sachets short", value: fmt(l.short), sub: "on receipt" },
              ].map((x) => (
                <div key={x.label} style={{ minWidth: 0 }}>
                  <div className="kpi-label">{x.label}</div>
                  <div className="kpi-value" style={{ fontSize: 18, color: x.label === "Sachets short" && l.short ? "var(--priority-critical)" : undefined }}>{x.value}</div>
                  <div className="kpi-sub">{x.sub}</div>
                </div>
              ))}
            </div>
          </Link>
        ))}
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
        <select className="input" name="lga" defaultValue={sp.lga ?? ""} aria-label="LGA" style={{ maxWidth: 170 }}>
          <option value="">All LGAs</option>
          {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
                  <td style={{ whiteSpace: "nowrap" }}>
                    {t.received_date ?? <span className="text-muted">—</span>}
                    {t.received_date && (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        after {Math.round((Date.parse(t.received_date) - Date.parse(t.issued_date)) / 86_400_000)} d
                      </div>
                    )}
                  </td>
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
