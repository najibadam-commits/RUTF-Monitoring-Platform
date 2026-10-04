import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canManageDatasets } from "@/lib/rbac";
import { getLgas, getAllWards, getProgrammeLgas, getStates } from "@/lib/queries/lookups";
import { lgaId, wardId } from "@/lib/wardId";
import { DataSetsTabs, type DataSetTab } from "@/components/datasets/DataSetsTabs";
import { FacilitiesTab, type Store } from "@/components/datasets/FacilitiesTab";
import { LotsTab } from "@/components/datasets/LotsTab";
import { ProtocolTab } from "@/components/datasets/ProtocolTab";
import { ThresholdsTab } from "@/components/datasets/ThresholdsTab";
import type { DatasetStatus, FacilityType } from "@/lib/types/database";

export const metadata: Metadata = { title: "Master Data" };

// RUTF reference data (brief §9, migration 0100). The TPM Settlements / Activity Sites sets are
// no longer shown; their tables are kept (DECISIONS R14). "Registry at a glance" (DECISIONS R95)
// sums up the supply chain, location quality, lots and rules above the tabs.

const PAGE_SIZE = 25;
const PENDING_STATUSES: DatasetStatus[] = ["pending_create", "pending_update", "pending_delete"];
const TABS: DataSetTab[] = ["facilities", "lots", "protocol", "thresholds"];
const FACILITY_TYPES: FacilityType[] = ["state_store", "lga_store", "health_facility"];

export default async function DataSetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) redirect("/dashboard");
  const isSuperAdmin = profile.role === "super_admin";

  const sp = await searchParams;
  const tab: DataSetTab = TABS.includes(sp.tab as DataSetTab) ? (sp.tab as DataSetTab) : "facilities";
  const supabase = await createClient();

  const pendingCount = isSuperAdmin
    ? ((await supabase.from("facilities").select("id", { count: "exact", head: true }).in("status", PENDING_STATUSES)).count ?? 0)
    : 0;

  // Registry at a glance — approved, active facilities only.
  const fac = () => supabase.from("facilities").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_active", true);
  const soon = new Date(Date.parse(new Date().toISOString().slice(0, 10)) + 90 * 86_400_000).toISOString().slice(0, 10);
  const counts = await Promise.all([
    fac().eq("facility_type", "state_store"),
    fac().eq("facility_type", "lga_store"),
    fac().eq("facility_type", "health_facility").eq("is_otp_site", true),
    fac().eq("facility_type", "health_facility").eq("is_otp_site", false),
    fac().eq("facility_type", "health_facility").eq("is_otp_site", true).not("supplied_by_facility_id", "is", null),
    fac().not("lat", "is", null),
    fac().not("ward_id", "is", null),
    fac().not("location_flag", "is", null),
    fac().eq("is_hard_to_reach", true),
    fac(),
    supabase.from("product_lots").select("id", { count: "exact", head: true }),
    supabase.from("product_lots").select("id", { count: "exact", head: true }).lte("expiry_date", soon),
    supabase.from("protocol_rules").select("id", { count: "exact", head: true }),
    supabase.from("rutf_thresholds").select("key", { count: "exact", head: true }),
  ]).then((rs) => rs.map((r) => r.count ?? 0));
  const [stateStores, lgaStores, otpSites, otherHf, otpLinked, withGps, withWard, flagged, hardToReach, allFac, lotCount, lotsSoon, ruleCount, thresholdCount] = counts;
  const share = (n: number, d: number) => (d ? `${Math.round((n * 100) / d)}%` : "—");

  let body: React.ReactNode;
  if (tab === "facilities") {
    const page = Math.max(1, Number(sp.page ?? "1") || 1);
    const from = (page - 1) * PAGE_SIZE;
    const search = sp.search?.replace(/[%,()]/g, " ").trim() || null;

    let q = supabase.from("facilities").select("*", { count: "exact" }).order("facility_type").order("name");
    if (search) q = q.or(`name.ilike.%${search}%,facility_code.ilike.%${search}%,national_code.ilike.%${search}%`);
    if (sp.status === "pending") q = q.in("status", PENDING_STATUSES);
    else if (sp.status) q = q.eq("status", sp.status as DatasetStatus);
    if (sp.lga) q = q.eq("lga_id", sp.lga);
    if (sp.type && FACILITY_TYPES.includes(sp.type as FacilityType)) q = q.eq("facility_type", sp.type as FacilityType);
    if (sp.otp === "1") q = q.eq("is_otp_site", true);
    if (sp.flagged === "1") q = q.not("location_flag", "is", null);

    const [{ data, count }, lgas, wards, { data: stores }, states, programmeLgas] = await Promise.all([
      q.range(from, from + PAGE_SIZE - 1),
      getLgas(supabase),
      getAllWards(supabase),
      supabase.from("facilities").select("id, name, facility_type, lga_id").in("facility_type", ["state_store", "lga_store"]).eq("status", "approved").order("name"),
      getStates(supabase),
      getProgrammeLgas(supabase),
    ]);

    // LGA ID (KT-DAU) and Ward ID (KT-DAU-MAJ) shown next to the names — DECISIONS R79, R80.
    const stateCode = Object.fromEntries(states.map((s) => [s.id, s.code]));
    const lgaById = Object.fromEntries(lgas.map((l) => [l.id, l]));
    const wardsByLga: Record<string, { id: string; name: string; code?: string | null }[]> = {};
    for (const w of wards) {
      const l = lgaById[w.lga_id];
      (wardsByLga[w.lga_id] ??= []).push({ id: w.id, name: w.name, code: wardId(l ? stateCode[l.state_id] : null, l?.abbr, w.abbr) });
    }
    const total = count ?? 0;

    body = (
      <FacilitiesTab
        rows={data ?? []}
        total={total}
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        filters={{ search: sp.search ?? "", status: sp.status ?? "", lga: sp.lga ?? "", type: sp.type ?? "", otp: sp.otp ?? "", flagged: sp.flagged ?? "" }}
        lgas={lgas.map((l) => ({ id: l.id, name: l.name, code: lgaId(stateCode[l.state_id], l.abbr) }))}
        programmeLgaIds={programmeLgas.map((l) => l.id)}
        wardsByLga={wardsByLga}
        stores={(stores ?? []) as Store[]}
        isSuperAdmin={isSuperAdmin}
        currentUserId={profile.id}
      />
    );
  } else if (tab === "lots") {
    const [{ data: lots }, { data: products }] = await Promise.all([
      supabase.from("product_lots").select("*").order("expiry_date"),
      supabase.from("products").select("id, name, units_per_carton, shelf_life_months").order("name"),
    ]);
    // Server-side "today" keeps the expiry badges identical between server and client render.
    const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
    body = <LotsTab lots={lots ?? []} products={products ?? []} isSuperAdmin={isSuperAdmin} today={today} />;
  } else if (tab === "protocol") {
    const { data: rules } = await supabase.from("protocol_rules").select("*").order("protocol_version").order("weight_min_kg");
    body = <ProtocolTab rules={rules ?? []} isSuperAdmin={isSuperAdmin} />;
  } else {
    const [{ data: thresholds }, { data: projects }] = await Promise.all([
      supabase.from("rutf_thresholds").select("*").order("key"),
      supabase.from("projects").select("id, name"),
    ]);
    body = (
      <ThresholdsTab
        thresholds={thresholds ?? []}
        projectName={Object.fromEntries((projects ?? []).map((p) => [p.id, p.name]))}
        isSuperAdmin={isSuperAdmin}
      />
    );
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Master Data</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          One trusted reference for RUTF tracking: the facility registry and supply chain, product lots, dosing rules and thresholds.
          Facility changes made by a Project Admin wait for Super Admin approval; lots, dosing rules and thresholds are changed by
          Super Admin only; every change is recorded in the Audit Trail.
          {pendingCount > 0 && <> <Link href="/data-sets?status=pending">{pendingCount} facility change{pendingCount === 1 ? " needs" : "s need"} your review.</Link></>}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div className="card elev-sm" style={{ padding: 14, gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
            <i className="ph-fill ph-tree-structure" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> Supply chain
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13 }}>
            <Link href="/data-sets?type=state_store"><strong>{stateStores}</strong> State store</Link>
            <i className="ph ph-arrow-right text-muted" aria-hidden="true" />
            <Link href="/data-sets?type=lga_store"><strong>{lgaStores}</strong> LGA stores</Link>
            <i className="ph ph-arrow-right text-muted" aria-hidden="true" />
            <Link href="/data-sets?otp=1"><strong>{otpSites}</strong> OTP sites</Link>
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {share(otpLinked, otpSites)} of OTP sites linked to their supplying LGA store · {otherHf.toLocaleString("en-GB")} other health facilities in the registry
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: 14, gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
            <i className="ph-fill ph-map-pin-area" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> Location quality
          </div>
          <div style={{ fontSize: 13 }}>
            <strong>{share(withGps, allFac)}</strong> with GPS · <strong>{share(withWard, allFac)}</strong> placed in a ward
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {flagged > 0 ? <Link href="/data-sets?flagged=1">{flagged} location{flagged === 1 ? "" : "s"} flagged to check</Link> : "No location flags"} ·{" "}
            {hardToReach} hard-to-reach (10% variance limit)
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: 14, gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
            <i className="ph-fill ph-package" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> Product and rules
          </div>
          <div style={{ fontSize: 13 }}>
            <Link href="/data-sets?tab=lots"><strong>{lotCount}</strong> lots</Link>
            {lotsSoon > 0 && <span style={{ color: "var(--priority-high)" }}> ({lotsSoon} expired or expiring within 90 days)</span>} ·{" "}
            <Link href="/data-sets?tab=protocol"><strong>{ruleCount}</strong> dosing rules</Link> ·{" "}
            <Link href="/data-sets?tab=thresholds"><strong>{thresholdCount}</strong> thresholds</Link>
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>Thresholds drive every flag, Finding and target on the platform.</div>
        </div>
      </div>

      <DataSetsTabs tab={tab} />
      {body}
    </div>
  );
}
