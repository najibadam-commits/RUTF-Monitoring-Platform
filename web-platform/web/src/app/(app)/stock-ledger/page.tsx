import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { TXN_LABEL, facilityNames, getFacilityLedger, getFacilitySummaries, signedQuantity } from "@/lib/queries/stock";
import { getFacilityMetrics, reportMonth } from "@/lib/queries/metrics";
import { tagBg } from "@/lib/constants";
import { canVoidLedger } from "@/lib/rbac";
import { VoidEntryButton } from "@/components/stock/VoidEntryButton";
import type { FacilityType, TxnType } from "@/lib/types/database";

export const metadata: Metadata = { title: "Stock Ledger" };

// Stock Ledger (brief §9; DECISIONS R102): stores and OTP sites with their stock position and months
// of stock (facility_metrics, latest ledger month), status tiles that filter the list, and per
// facility the balance by lot, the last 30 days' movement, the ledger's integrity (entries, voids,
// photo evidence) and every transaction with its running balance. RLS scopes everything — a facility
// user goes straight to their own facility.

const PAGE_SIZE = 25;
const EXPIRY_WARN_DAYS = 90;
const TYPE_LABEL: Record<FacilityType, string> = { state_store: "State store", lga_store: "LGA store", health_facility: "OTP site" };
const TXN_COLOR: Partial<Record<TxnType, string>> = {
  receipt: "var(--status-resolved)",
  issue: "var(--color-accent-600)",
  dispensed: "var(--color-accent-800)",
  loss_damaged: "var(--priority-critical)",
  loss_expired: "var(--priority-critical)",
  loss_other: "var(--priority-critical)",
  adjustment: "var(--priority-high)",
  physical_count: "var(--color-neutral-600)",
};

const fmt = (n: number) => n.toLocaleString("en-GB");
const STRUCK = { textDecoration: "line-through", opacity: 0.55 } as const;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

type SP = Record<string, string | undefined>;

function hrefWith(sp: SP, patch: SP) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) params.set(k, v);
  const qs = params.toString();
  return `/stock-ledger${qs ? `?${qs}` : ""}`;
}

function Pager({ sp, page, totalPages, total, noun }: { sp: SP; page: number; totalPages: number; total: number; noun: string }) {
  const off = { opacity: 0.45, pointerEvents: "none" as const };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
      <span className="text-muted" style={{ fontSize: 12.5 }}>
        {fmt(total)} {noun} — page {page} of {totalPages}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <Link className="btn btn-secondary" href={hrefWith(sp, { page: String(page - 1) })} style={page <= 1 ? off : undefined} aria-disabled={page <= 1}>
          Previous
        </Link>
        <Link className="btn btn-secondary" href={hrefWith(sp, { page: String(page + 1) })} style={page >= totalPages ? off : undefined} aria-disabled={page >= totalPages}>
          Next
        </Link>
      </div>
    </div>
  );
}

export default async function StockLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  if (profile.role === "dri" && profile.facility_id && sp.facility !== profile.facility_id) {
    redirect(`/stock-ledger?facility=${profile.facility_id}`);
  }
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  return sp.facility
    ? <FacilityLedger supabase={supabase} facilityId={sp.facility} sp={sp} today={today} isDri={profile.role === "dri"} canVoid={canVoidLedger(profile.role)} />
    : <FacilityList supabase={supabase} sp={sp} today={today} />;
}

// ── List ────────────────────────────────────────────────────────────────────────────────────────

async function FacilityList({ supabase, sp, today }: { supabase: Awaited<ReturnType<typeof createClient>>; sp: SP; today: string }) {
  const month = await reportMonth(supabase, undefined);
  const [summaries, lgas, metrics] = await Promise.all([getFacilitySummaries(supabase, today), getProgrammeLgas(supabase), getFacilityMetrics(supabase, month, {})]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const mosOf = Object.fromEntries(metrics.map((m) => [m.facility_id, m.months_of_stock === null ? null : Number(m.months_of_stock)]));
  const lowMos = (id: string) => mosOf[id] !== null && mosOf[id] !== undefined && mosOf[id]! < 1;
  const expiringSoon = (f: { nextExpiry: string | null }) => !!f.nextExpiry && daysBetween(today, f.nextExpiry) <= EXPIRY_WARN_DAYS;
  const search = sp.search?.trim().toLowerCase();
  const filtered = summaries
    .filter((f) => !sp.type || f.facility_type === sp.type)
    .filter((f) => !sp.lga || f.lga_id === sp.lga)
    .filter((f) => !search || f.name.toLowerCase().includes(search))
    .filter((f) => sp.flag !== "stockout" || f.balance <= 0)
    .filter((f) => sp.flag !== "lowmos" || (f.balance > 0 && lowMos(f.id)))
    .filter((f) => sp.flag !== "expiring" || expiringSoon(f))
    .filter((f) => sp.flag !== "expired" || f.expiredBalance > 0)
    .sort((a, b) => ["state_store", "lga_store", "health_facility"].indexOf(a.facility_type) - ["state_store", "lga_store", "health_facility"].indexOf(b.facility_type) || a.name.localeCompare(b.name));
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totals = (type: FacilityType) => summaries.filter((f) => f.facility_type === type).reduce((n, f) => n + Math.max(0, f.balance), 0);
  const stockedOut = summaries.filter((f) => f.balance <= 0).length;
  const holdingExpired = summaries.filter((f) => f.expiredBalance > 0).length;
  const underOneMonth = summaries.filter((f) => f.balance > 0 && lowMos(f.id)).length;
  const expiring = summaries.filter(expiringSoon).length;
  const flagTiles = [
    { key: "stockout", label: "Out of stock", value: stockedOut, icon: "ph-prohibit", color: "var(--priority-critical)" },
    { key: "lowmos", label: "Under 1 month of stock", value: underOneMonth, icon: "ph-package", color: "var(--priority-high)" },
    { key: "expiring", label: `Lot expiring within ${EXPIRY_WARN_DAYS} days`, value: expiring, icon: "ph-hourglass-medium", color: "var(--priority-high)" },
    { key: "expired", label: "Holding expired stock", value: holdingExpired, icon: "ph-calendar-x", color: "var(--priority-critical)" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Stock Ledger</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          Every sachet in and out of every store and OTP site, as ledger entries by lot and expiry. Balances are computed from the
          entries, never typed in; an entry is never edited or deleted, only voided by an administrator with a reason, and stays
          visible. Open a facility for its lots and transactions.
        </p>
      </div>

      <div className="card elev-sm" style={{ padding: 14, gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
          Stock on hand along the supply chain
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {(["state_store", "lga_store", "health_facility"] as FacilityType[]).map((t, i) => (
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
              {i > 0 && <i className="ph ph-arrow-right text-muted" aria-hidden="true" style={{ fontSize: 18 }} />}
              <Link href={hrefWith({}, { type: t })} style={{ textDecoration: "none", color: "inherit" }}>
                <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 700 }}>{fmt(totals(t))}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>sachets at {t === "state_store" ? "the State store" : t === "lga_store" ? "LGA stores" : "OTP sites"}</span>
              </Link>
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {flagTiles.map((k) => {
          const active = sp.flag === k.key;
          return (
            <Link key={k.key} href={hrefWith({}, active ? {} : { flag: k.key })} className="card elev-sm" aria-pressed={active}
              title={active ? "Show every facility" : `List: ${k.label.toLowerCase()}`}
              style={{ padding: 14, gap: 2, textDecoration: "none", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-neutral-700)" }}>
                <i className={`ph-fill ${k.icon}`} aria-hidden="true" style={{ fontSize: 15, color: k.value ? k.color : "var(--status-resolved)" }} /> {k.label}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 700 }}>{fmt(k.value)}</div>
              <div className="text-muted" style={{ fontSize: 11.5 }}>{active ? "Filtered · click to clear" : "facilities"}</div>
            </Link>
          );
        })}
      </div>

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <input className="input" name="search" placeholder="Search facility…" defaultValue={sp.search ?? ""} style={{ maxWidth: 220 }} />
        <select className="input" name="type" defaultValue={sp.type ?? ""} style={{ maxWidth: 160 }}>
          <option value="">All levels</option>
          {(Object.keys(TYPE_LABEL) as FacilityType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select className="input" name="lga" defaultValue={sp.lga ?? ""} style={{ maxWidth: 170 }}>
          <option value="">All LGAs</option>
          {lgas.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select className="input" name="flag" defaultValue={sp.flag ?? ""} style={{ maxWidth: 190 }}>
          <option value="">Any stock position</option>
          <option value="stockout">Out of stock</option>
          <option value="lowmos">Under 1 month of stock</option>
          <option value="expiring">Lot expiring within {EXPIRY_WARN_DAYS} days</option>
          <option value="expired">Holding expired stock</option>
        </select>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {(sp.search || sp.type || sp.lga || sp.flag) && <Link className="btn btn-secondary" href="/stock-ledger"><i className="ph ph-x-circle" /> Clear</Link>}
      </form>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Facility</th>
              <th>Level</th>
              <th>LGA</th>
              <th style={{ textAlign: "right" }}>On hand (sachets)</th>
              <th style={{ textAlign: "right" }}>Months of stock</th>
              <th>Next expiry</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td><Link href={hrefWith({}, { facility: f.id })} style={{ fontWeight: 500 }}>{f.name}</Link></td>
                <td className="text-muted">{TYPE_LABEL[f.facility_type]}</td>
                <td>{lgaName[f.lga_id] ?? "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: f.balance <= 0 ? "var(--priority-critical)" : undefined }}>
                  {fmt(f.balance)}
                  {f.expiredBalance > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 400, color: "var(--priority-critical)" }}>{fmt(f.expiredBalance)} expired</div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {mosOf[f.id] === null || mosOf[f.id] === undefined ? <span className="text-muted">—</span> : lowMos(f.id)
                    ? <span style={{ color: "var(--priority-high)", fontWeight: 600 }}><i className="ph-fill ph-warning" aria-hidden="true" /> {mosOf[f.id]!.toFixed(1)}</span>
                    : mosOf[f.id]!.toFixed(1)}
                </td>
                <td style={{ color: f.nextExpiry && daysBetween(today, f.nextExpiry) <= EXPIRY_WARN_DAYS ? "var(--priority-high)" : undefined }}>
                  {f.nextExpiry ?? "—"}
                </td>
                <td className="text-muted">{f.lastTxnDate ?? "No records"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No facilities match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <Pager sp={sp} page={page} totalPages={totalPages} total={filtered.length} noun="facilities" />
      </div>
    </div>
  );
}

// ── One facility ────────────────────────────────────────────────────────────────────────────────

async function FacilityLedger({
  supabase,
  facilityId,
  sp,
  today,
  isDri,
  canVoid,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  facilityId: string;
  sp: SP;
  today: string;
  isDri: boolean;
  canVoid: boolean;
}) {
  const { data: facility } = await supabase.from("facilities").select("*").eq("id", facilityId).maybeSingle();
  if (!facility) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Stock Ledger</h2>
        <p className="text-muted">That facility wasn&apos;t found, or you don&apos;t have access to it.</p>
        {!isDri && <Link href="/stock-ledger">Back to all facilities</Link>}
      </div>
    );
  }

  const month = await reportMonth(supabase, undefined);
  const [ledger, { data: balances }, { data: photos }, lgas, { data: product }, metrics] = await Promise.all([
    getFacilityLedger(supabase, facilityId),
    supabase.from("stock_balances").select("*").eq("facility_id", facilityId).order("expiry_date"),
    supabase.from("ledger_photos").select("*").eq("facility_id", facilityId),
    getProgrammeLgas(supabase),
    supabase.from("products").select("units_per_carton").order("created_at").limit(1).maybeSingle(),
    getFacilityMetrics(supabase, month, {}),
  ]);
  const metric = metrics.find((m) => m.facility_id === facilityId);
  const mos = metric?.months_of_stock === null || metric?.months_of_stock === undefined ? null : Number(metric.months_of_stock);
  const perCarton = product?.units_per_carton ?? 150;
  const names = await facilityNames(supabase, [facility.supplied_by_facility_id, ...ledger.map((t) => t.counterparty_facility_id)]);
  const photoUrls: Record<string, { url: string; kind: string }[]> = {};
  for (const p of photos ?? []) {
    const { data } = await supabase.storage.from("ledger-evidence").createSignedUrl(p.storage_path, 3600);
    if (data?.signedUrl) (photoUrls[p.submission_local_id] ??= []).push({ url: data.signedUrl, kind: p.kind });
  }

  const typeFilter = sp.txn as TxnType | undefined;
  const lotFilter = sp.lot;
  const visible = ledger
    .filter((t) => !typeFilter || t.txn_type === typeFilter)
    .filter((t) => !lotFilter || (lotFilter === "none" ? !t.lot_id : t.lot_id === lotFilter))
    .reverse();
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const lotBalances = (balances ?? []).filter((b) => b.balance !== 0 || b.lot_id);
  const total = ledger.length ? ledger[ledger.length - 1].runningBalance : 0;
  const lastCount = [...ledger].reverse().find((t) => t.txn_type === "physical_count");
  const lgaName = lgas.find((l) => l.id === facility.lga_id)?.name ?? "—";
  // The last 30 days' movement and the ledger's integrity at a glance (R102).
  const since = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  const recent = ledger.filter((t) => t.status !== "voided" && t.txn_date >= since);
  const sumOf = (types: TxnType[]) => recent.filter((t) => types.includes(t.txn_type)).reduce((n, t) => n + t.quantity_sachets, 0);
  const moved = { in: sumOf(["receipt"]), out: sumOf(["issue", "dispensed"]), lost: sumOf(["loss_damaged", "loss_expired", "loss_other"]) };
  const voidedCount = ledger.filter((t) => t.status === "voided").length;
  const withEvidence = new Set(ledger.filter((t) => t.submission_local_id && photoUrls[t.submission_local_id]).map((t) => t.submission_local_id)).size;
  const submissions = new Set(ledger.map((t) => t.submission_local_id ?? t.id)).size;
  // Who voided what (migration 0109), and where each submission's void button goes: its first row on this page.
  const voiders = [...new Set(ledger.map((t) => t.voided_by).filter((v): v is string => !!v))];
  const { data: voiderRows } = voiders.length ? await supabase.from("profiles").select("id, name").in("id", voiders) : { data: [] };
  const voiderName = Object.fromEntries((voiderRows ?? []).map((p) => [p.id, p.name]));
  const voidHere = new Set<string>();
  const seenSubmission = new Set<string>();
  for (const t of rows) {
    if (t.submission_local_id && t.status !== "voided" && !seenSubmission.has(t.submission_local_id)) voidHere.add(t.id);
    if (t.submission_local_id) seenSubmission.add(t.submission_local_id);
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        {!isDri && (
          <Link href="/stock-ledger" style={{ fontSize: 13 }}>
            <i className="ph ph-arrow-left" /> All facilities
          </Link>
        )}
        <h2 style={{ margin: "6px 0 2px" }}>{facility.name}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {facility.facility_code && <>{facility.facility_code} · </>}{TYPE_LABEL[facility.facility_type]} · {lgaName}
          {facility.supplied_by_facility_id && <> · supplied by {names[facility.supplied_by_facility_id] ?? "—"}</>}
          {" · "}
          <Link href={`/transfers?facility=${facility.id}`}>Transfers</Link>
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12.5 }}>On hand</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: total <= 0 ? "var(--priority-critical)" : undefined }}>{fmt(total)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>sachets ({fmt(Math.floor(Math.max(0, total) / perCarton))} cartons)</div>
        </div>
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Months of stock</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: mos !== null && mos < 1 ? "var(--priority-high)" : undefined }}>{mos === null ? "—" : mos.toFixed(1)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {metric?.monthly_outflow ? `at ${fmt(Math.round(Number(metric.monthly_outflow)))} sachets a month` : "No outflow this month"}
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Last 30 days</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <span style={{ color: "var(--status-resolved)", fontWeight: 600 }}>+{fmt(moved.in)}</span> received<br />
            <span style={{ color: "var(--color-accent-700)", fontWeight: 600 }}>−{fmt(moved.out)}</span> {facility.is_otp_site ? "dispensed" : "issued"}
            {moved.lost > 0 && <><br /><span style={{ color: "var(--priority-critical)", fontWeight: 600 }}>−{fmt(moved.lost)}</span> lost</>}
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12.5 }}>Last physical count</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{lastCount ? fmt(lastCount.quantity_sachets) : "—"}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>{lastCount ? lastCount.txn_date : "No count recorded"}</div>
        </div>
        {lotBalances.map((b) => {
          const expired = b.expiry_date && b.expiry_date < today && b.balance > 0;
          const soon = b.expiry_date && !expired && daysBetween(today, b.expiry_date) <= EXPIRY_WARN_DAYS && b.balance > 0;
          return (
            <div key={b.lot_id ?? "none"} className="card elev-sm" style={{ padding: 14 }}>
              <div className="text-muted" style={{ fontSize: 12.5 }}>{b.lot_id ? `Lot ${b.lot_no}` : "No lot recorded"}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(b.balance)}</div>
              <div style={{ fontSize: 12, color: expired ? "var(--priority-critical)" : soon ? "var(--priority-high)" : "var(--color-neutral-600)" }}>
                {b.expiry_date ? `${expired ? "Expired" : "Expires"} ${b.expiry_date}` : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-muted" style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <i className="ph-fill ph-shield-check" aria-hidden="true" style={{ color: "var(--status-resolved)", fontSize: 16 }} />
        <span>
          <strong style={{ color: "var(--color-text)" }}>Ledger integrity:</strong> {fmt(ledger.length)} entries from {fmt(submissions)} submissions ·{" "}
          {voidedCount ? `${fmt(voidedCount)} voided with a reason, still shown` : "none voided"} ·{" "}
          {withEvidence > 0 && <>{fmt(withEvidence)} with photo evidence · </>}entries are never edited or deleted.
        </span>
      </div>

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <input type="hidden" name="facility" defaultValue={facility.id} />
        <select className="input" name="txn" defaultValue={sp.txn ?? ""} style={{ maxWidth: 180 }}>
          <option value="">All transaction types</option>
          {(Object.keys(TXN_LABEL) as TxnType[]).map((t) => (
            <option key={t} value={t}>{TXN_LABEL[t]}</option>
          ))}
        </select>
        <select className="input" name="lot" defaultValue={sp.lot ?? ""} style={{ maxWidth: 180 }}>
          <option value="">All lots</option>
          {lotBalances.filter((b) => b.lot_id).map((b) => (
            <option key={b.lot_id!} value={b.lot_id!}>Lot {b.lot_no}</option>
          ))}
          <option value="none">No lot</option>
        </select>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {(sp.txn || sp.lot) && <Link className="btn btn-secondary" href={hrefWith({}, { facility: facility.id })}><i className="ph ph-x-circle" /> Clear</Link>}
      </form>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Lot</th>
              <th style={{ textAlign: "right" }}>Sachets</th>
              <th style={{ textAlign: "right" }}>Balance</th>
              <th>Counterparty / reference</th>
              <th>Note</th>
              {canVoid && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const signed = signedQuantity(t);
              const color = TXN_COLOR[t.txn_type] ?? "var(--color-neutral-600)";
              const evidence = t.submission_local_id ? photoUrls[t.submission_local_id] : undefined;
              return (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap", ...(t.status === "voided" ? STRUCK : {}) }}>{t.txn_date}</td>
                  <td>
                    <span className="tag" style={{ background: tagBg(color), color, ...(t.status === "voided" ? STRUCK : {}) }}>{TXN_LABEL[t.txn_type]}</span>
                    {t.status === "voided" && (
                      <div style={{ fontSize: 11, color: "var(--color-neutral-700)", marginTop: 2 }}>
                        <i className="ph ph-prohibit" aria-hidden="true" /> Voided{t.voided_by ? ` by ${voiderName[t.voided_by] ?? "an administrator"}` : ""}
                        {t.voided_at ? ` on ${t.voided_at.slice(0, 10)}` : ""}
                      </div>
                    )}
                    {t.txn_type === "adjustment" && t.status === "recorded" && (
                      <div style={{ fontSize: 11, color: "var(--priority-high)", marginTop: 2 }}>awaiting supervisor confirmation</div>
                    )}
                  </td>
                  <td className="text-muted" style={{ fontSize: 13, ...(t.status === "voided" ? STRUCK : {}) }}>{t.lotNo ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: t.txn_type === "physical_count" ? "var(--color-neutral-600)" : signed < 0 ? "var(--priority-critical)" : "var(--status-resolved)", ...(t.status === "voided" ? STRUCK : {}) }}>
                    {t.txn_type === "physical_count" ? `counted ${fmt(t.quantity_sachets)}` : `${signed > 0 ? "+" : ""}${fmt(signed)}`}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(t.runningBalance)}</td>
                  <td style={{ fontSize: 13 }}>
                    {t.counterparty_facility_id && <div>{t.txn_type === "issue" ? "To " : "From "}{names[t.counterparty_facility_id] ?? "another facility"}</div>}
                    {t.transfer_id && <Link href={`/transfers?transfer=${t.transfer_id}`} className="text-muted" style={{ fontSize: 12 }}>transfer</Link>}
                    {t.document_no && <div className="text-muted" style={{ fontSize: 12 }}>{t.document_no}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    <span style={t.status === "voided" ? STRUCK : undefined}>{t.reason}</span>
                    {t.status === "voided" && t.void_reason && <div style={{ fontSize: 12 }}>Void reason: {t.void_reason}</div>}
                    {evidence?.map((e, i) => (
                      <a key={i} href={e.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, fontSize: 12 }}>
                        <i className="ph ph-image" /> {e.kind.replace("_", " ")}
                      </a>
                    ))}
                  </td>
                  {canVoid && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      {voidHere.has(t.id) && t.submission_local_id && (
                        <VoidEntryButton localId={t.submission_local_id} label={`${TXN_LABEL[t.txn_type].toLowerCase()} of ${t.txn_date}`} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={canVoid ? 8 : 7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No transactions{typeFilter || lotFilter ? " match these filters" : " recorded yet"}.</td></tr>
            )}
          </tbody>
        </table>
        <Pager sp={sp} page={page} totalPages={totalPages} total={visible.length} noun="transactions" />
      </div>
    </div>
  );
}
