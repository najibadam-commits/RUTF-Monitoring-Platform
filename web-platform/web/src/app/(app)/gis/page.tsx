import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getDris, getLgas, getStates } from "@/lib/queries/lookups";
import { STATUS_LABEL, STATUS_FILTER_OPTIONS, STATUS_COLOR } from "@/lib/constants";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { GisMap, type GisFacility } from "@/components/gis/GisMap";
import { getFacilityMetrics, reportMonth } from "@/lib/queries/metrics";

export const metadata: Metadata = { title: "Situation Map" };

const AUTOMATIC = "Automatic checks";

export default async function GisPage() {
  const supabase = await createClient();

  // getCategories() (active-only), not getAllCategories() — the Sector filter dropdown should
  // only ever offer the current 8 approved sectors, not legacy pre-rebrand categories. A Finding
  // still tagged with a legacy category (is_active=false) remains visible under "All Sectors" and
  // still shows its real category name on the map's detail panel — it just can't be filtered to
  // specifically by name anymore, which is the intended behavior here (unlike the Issues list
  // page's filter/export, which deliberately keeps legacy categories filterable for historical
  // lookups — see getAllCategories' kdoc).
  const [{ data: issuesRaw }, states, categories, dris, lgas] = await Promise.all([
    supabase
      .from("issues")
      .select(
        "id, code, description, status, priority, lat, lng, reported_at, auto_generated, category:categories(name), state:states(id, name), lga:lgas(id, name), ward, reporter:profiles!issues_reported_by_fkey(name), dri:profiles!issues_assigned_dri_fkey(name)",
      )
      .not("lat", "is", null)
      .not("lng", "is", null),
    getStates(supabase),
    getCategories(supabase),
    getDris(supabase),
    getLgas(supabase),
  ]);

  // Facility layer (brief §9 map): stores and OTP sites coloured by risk score or months of stock,
  // for the latest month in the ledger — facility_metrics / facility_risk (migration 0105).
  const month = await reportMonth(supabase, undefined);
  const [metrics, { data: risk }, { data: points }, { data: riskHigh }] = await Promise.all([
    getFacilityMetrics(supabase, month, {}),
    supabase.rpc("facility_risk", { p_as_of: month.end }),
    supabase.from("facilities").select("id, lat, lng").eq("status", "approved")
      .or("facility_type.neq.health_facility,is_otp_site.eq.true").not("lat", "is", null).not("lng", "is", null),
    supabase.from("rutf_thresholds").select("value").eq("key", "risk_high").limit(1).maybeSingle(),
  ]);
  const riskById = new Map((risk ?? []).map((r) => [r.facility_id, r.risk_score]));
  const pointById = new Map((points ?? []).map((p) => [p.id, p]));
  const facilities: GisFacility[] = metrics.flatMap((m) => {
    const p = pointById.get(m.facility_id);
    if (!p) return [];
    return [{
      id: m.facility_id, name: m.facility_name, type: m.facility_type, lgaId: m.lga_id,
      lat: Number(p.lat), lng: Number(p.lng), balance: m.balance,
      monthsOfStock: m.months_of_stock === null ? null : Number(m.months_of_stock),
      risk: riskById.get(m.facility_id) ?? null,
    }];
  });

  const issues = (issuesRaw ?? []).map((i) => ({
    id: i.id as string,
    code: i.code as string,
    description: i.description as string,
    status: i.status as string,
    priority: i.priority as string,
    lat: Number(i.lat),
    lng: Number(i.lng),
    reportedAt: i.reported_at as string,
    category: (i.category as unknown as { name: string } | null)?.name ?? "—",
    stateId: (i.state as unknown as { id: string } | null)?.id ?? "",
    stateName: (i.state as unknown as { name: string } | null)?.name ?? "—",
    lgaId: (i.lga as unknown as { id: string } | null)?.id ?? "",
    lgaName: (i.lga as unknown as { name: string } | null)?.name ?? "—",
    ward: (i.ward as string | null) ?? "—",
    reportedBy: i.auto_generated ? AUTOMATIC : (i.reporter as unknown as { name: string } | null)?.name ?? "—",
    driName: (i.dri as unknown as { name: string } | null)?.name ?? null,
  }));

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <RealtimeRefresher table="issues" />
      <GisMap
        issues={issues}
        states={states.map((s) => ({ id: s.id, name: s.name }))}
        lgas={lgas.map((l) => ({ id: l.id, stateId: l.state_id, name: l.name }))}
        categories={categories.map((c) => c.name)}
        statuses={STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] }))}
        reporters={[AUTOMATIC, ...[...new Set(issues.map((i) => i.reportedBy))].filter((n) => n !== AUTOMATIC && n !== "—").sort()]}
        driNames={dris.map((d) => d.name)}
        facilities={facilities}
        facilityMonth={month.label}
        riskHigh={Number(riskHigh?.value ?? 50)}
      />
    </div>
  );
}
