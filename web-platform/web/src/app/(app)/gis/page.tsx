import { createClient } from "@/lib/supabase/server";
import { getCategories, getDris, getLgas, getStates, getTpms } from "@/lib/queries/lookups";
import { STATUS_LABEL, STATUS_FILTER_OPTIONS, STATUS_COLOR } from "@/lib/constants";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { GisMap } from "@/components/gis/GisMap";

export default async function GisPage() {
  const supabase = await createClient();

  // getCategories() (active-only), not getAllCategories() — the Sector filter dropdown should
  // only ever offer the current 8 approved sectors, not legacy pre-rebrand categories. A Finding
  // still tagged with a legacy category (is_active=false) remains visible under "All Sectors" and
  // still shows its real category name on the map's detail panel — it just can't be filtered to
  // specifically by name anymore, which is the intended behavior here (unlike the Issues list
  // page's filter/export, which deliberately keeps legacy categories filterable for historical
  // lookups — see getAllCategories' kdoc).
  const [{ data: issuesRaw }, states, categories, tpms, dris, lgas] = await Promise.all([
    supabase
      .from("issues")
      .select(
        "id, code, description, status, priority, lat, lng, reported_at, category:categories(name), state:states(id, name), lga:lgas(id, name), ward, reporter:profiles!issues_reported_by_fkey(name), dri:profiles!issues_assigned_dri_fkey(name)",
      )
      .not("lat", "is", null)
      .not("lng", "is", null),
    getStates(supabase),
    getCategories(supabase),
    getTpms(supabase),
    getDris(supabase),
    getLgas(supabase),
  ]);

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
    tpmName: (i.reporter as unknown as { name: string } | null)?.name ?? "—",
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
        tpmNames={tpms.map((t) => t.name)}
        driNames={dris.map((d) => d.name)}
      />
    </div>
  );
}
