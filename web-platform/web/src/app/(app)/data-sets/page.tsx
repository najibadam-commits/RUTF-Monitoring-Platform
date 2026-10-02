import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canManageDatasets } from "@/lib/rbac";
import { getStates, getLgas, getAllWards } from "@/lib/queries/lookups";
import { DataSetsClient } from "@/components/datasets/DataSetsClient";
import type { Database, DatasetStatus } from "@/lib/types/database";

type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
type ActivitySite = Database["public"]["Tables"]["activity_sites"]["Row"];

const PAGE_SIZE = 20;
const PENDING_STATUSES: DatasetStatus[] = ["pending_create", "pending_update", "pending_delete"];

export default async function DataSetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (!canManageDatasets(profile.role)) redirect("/dashboard");

  const sp = await searchParams;
  const tab: "settlements" | "activitySites" = sp.tab === "activitySites" ? "activitySites" : "settlements";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const searchTerm = sp.search?.replace(/[%,()]/g, " ").trim() || null;

  const supabase = await createClient();

  // Unbounded select("*") used to hit PostgREST's silent max-rows cap (observed 1000) — with
  // 354,148 settlements / 32,201 activity_sites, this screen never actually showed (or let
  // admins search/act on) the real data. Real server-side pagination + filters instead (see
  // DECISIONS.md #18, closing the loop opened in #17). Kept as two explicit branches rather than
  // a dynamic .from(tableName) so each query stays properly typed against its own table.
  let rowsPromise;
  if (tab === "settlements") {
    let q = supabase.from("settlements").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (searchTerm) q = q.or(`settlementname.ilike.%${searchTerm}%,statename.ilike.%${searchTerm}%,lganame.ilike.%${searchTerm}%`);
    if (sp.status === "pending") q = q.in("status", PENDING_STATUSES);
    else if (sp.status) q = q.eq("status", sp.status as DatasetStatus);
    if (sp.state) q = q.eq("statename", sp.state);
    if (sp.lga) q = q.eq("lganame", sp.lga);
    rowsPromise = q.range(from, to);
  } else {
    let q = supabase.from("activity_sites").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (searchTerm) q = q.or(`activitysitename.ilike.%${searchTerm}%,statename.ilike.%${searchTerm}%,lganame.ilike.%${searchTerm}%`);
    if (sp.status === "pending") q = q.in("status", PENDING_STATUSES);
    else if (sp.status) q = q.eq("status", sp.status as DatasetStatus);
    if (sp.state) q = q.eq("statename", sp.state);
    if (sp.lga) q = q.eq("lganame", sp.lga);
    rowsPromise = q.range(from, to);
  }

  const [{ data, count }, states, allLgas, allWards, pendingSettlements, pendingActivitySites] = await Promise.all([
    rowsPromise,
    getStates(supabase),
    getLgas(supabase),
    getAllWards(supabase),
    profile.role === "super_admin"
      ? supabase.from("settlements").select("id", { count: "exact", head: true }).in("status", PENDING_STATUSES)
      : Promise.resolve({ count: 0 }),
    profile.role === "super_admin"
      ? supabase.from("activity_sites").select("id", { count: "exact", head: true }).in("status", PENDING_STATUSES)
      : Promise.resolve({ count: 0 }),
  ]);

  const rows = (data ?? []) as (Settlement | ActivitySite)[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pendingCount = (pendingSettlements.count ?? 0) + (pendingActivitySites.count ?? 0);

  // Grouped client-side by parent id — small enough (774 LGAs, 9.4k wards)
  // to send once rather than round-tripping per dropdown change.
  const lgasByState: Record<string, { id: string; name: string }[]> = {};
  for (const s of states) lgasByState[s.id] = allLgas.filter((l) => l.state_id === s.id).map((l) => ({ id: l.id, name: l.name }));

  const wardsByLga: Record<string, { id: string; name: string }[]> = {};
  for (const l of allLgas) wardsByLga[l.id] = allWards.filter((w) => w.lga_id === l.id).map((w) => ({ id: w.id, name: w.name }));

  return (
    <DataSetsClient
      tab={tab}
      rows={rows}
      total={total}
      page={page}
      totalPages={totalPages}
      pendingCount={pendingCount}
      filters={{ search: sp.search ?? "", status: sp.status ?? "", state: sp.state ?? "", lga: sp.lga ?? "" }}
      states={states.map((s) => ({ id: s.id, name: s.name }))}
      lgasByState={lgasByState}
      wardsByLga={wardsByLga}
      isSuperAdmin={profile.role === "super_admin"}
      currentUserId={profile.id}
    />
  );
}
