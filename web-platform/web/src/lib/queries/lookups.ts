import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

// Every lookup below is wrapped in React's cache() so it's memoized per request (by its
// arguments, including the client instance) — a page/layout tree that asks for the same lookup
// more than once (e.g. Issue Detail's two differently-scoped getDris() calls sit right next to
// several other lookups on the same `supabase` client) costs at most one round trip per distinct
// call, not one per call site. Mirrors the same pattern already used for getCurrentProfile() in
// lib/supabase/dal.ts.

// states/lgas/wards carry PostGIS `geom`/`geom_simplified` columns that can
// be tens of KB of hex-WKB each — `select("*")` on 774 LGAs (or 9.4k wards)
// would pull megabytes just to populate a name dropdown. Every lookup here
// selects an explicit column list to avoid that; boundary geometry is only
// ever fetched via the get_*_boundaries() GeoJSON RPCs (see components/gis).

/** Active sectors only — for a "choose a sector" picker on a new submission or correction. A
 *  legacy (is_active = false) category stays resolvable by id wherever an existing Finding
 *  already references it (see migration 0032/DECISIONS.md #22), but must never be offered as a
 *  choice going forward. For a *filter* list (which must still be able to find old Findings under
 *  their legacy category), use [getAllCategories] instead. */
export const getCategories = cache(async (client: SupabaseClient<Database>) => {
  const { data } = await client.from("categories").select("id, name, sort_order").eq("is_active", true).order("sort_order");
  return data ?? [];
});

/** Every category/sector, active or legacy — see getCategories' kdoc for when to use which. */
export const getAllCategories = cache(async (client: SupabaseClient<Database>) => {
  const { data } = await client.from("categories").select("id, name, sort_order").order("sort_order");
  return data ?? [];
});

export const getStates = cache(async (client: SupabaseClient<Database>) => {
  const { data } = await client.from("states").select("id, code, name, geozone, capital").order("name");
  return data ?? [];
});

export const getLgas = cache(async (client: SupabaseClient<Database>, stateId?: string) => {
  let query = client.from("lgas").select("id, state_id, code, name").order("name");
  if (stateId) query = query.eq("state_id", stateId);
  const { data } = await query;
  return data ?? [];
});

/**
 * All wards nationally (id/lga_id/name only — no geometry). Used by the Master Data screen so
 * Settlement/Activity Site forms and CSV upload can resolve a typed-in Ward name to a real
 * ward_id without a round trip per row. A one-time payload for an admin screen is fine; lazy
 * per-LGA loading isn't worth the complexity here (contrast with the Android app, which does
 * load these lazily — see ReferenceRepository.kt — because it's paying real mobile-data cost
 * per field user).
 *
 * Paginated with .range() rather than one unbounded select() — PostgREST caps a single
 * request at its configured max-rows (observed default here: 1000), so a plain select()
 * silently truncated the wards list to the first 1000 alphabetically, breaking ward-name
 * resolution for anything sorting after that cutoff. Confirmed live: 6,166 wards seeded,
 * only 1,000 were ever reaching the client before this fix.
 */
export const getAllWards = cache(async (client: SupabaseClient<Database>) => {
  type WardRow = { id: string; lga_id: string; code: string | null; name: string };
  const PAGE_SIZE = 1000;
  const all: WardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await client
      .from("wards")
      .select("id, lga_id, code, name")
      .order("name")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
});

/** [categoryId] narrows to DRIs assigned that sector — used by the State Coordinator's
 *  approve-and-assign picker, since a Finding may only go to a DRI whose sector matches it (see
 *  DECISIONS.md #22). Omit it for callers that need every active DRI regardless of sector (e.g.
 *  Users & Access' listing, or the legacy assign_issue path for a pre-migration 'new' Finding). */
export const getDris = cache(async (client: SupabaseClient<Database>, categoryId?: string) => {
  let query = client.from("profiles").select("id, name, phone, email").eq("role", "dri").eq("status", "active").order("name");
  if (categoryId) query = query.eq("assigned_category_id", categoryId);
  const { data } = await query;
  return data ?? [];
});

export const getTpms = cache(async (client: SupabaseClient<Database>) => {
  const { data } = await client
    .from("profiles")
    .select("id, name")
    .eq("role", "tpm_supervisor")
    .eq("status", "active")
    .order("name");
  return data ?? [];
});
