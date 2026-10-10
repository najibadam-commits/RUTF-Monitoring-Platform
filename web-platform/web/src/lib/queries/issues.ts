import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IssuePriority, IssueStatus } from "@/lib/types/database";
import { OPEN_STATUSES } from "@/lib/constants";

export const ISSUE_SELECT = `
  *,
  category:categories(id, name),
  state:states(id, name, code),
  lga:lgas(id, name, abbr),
  ward_ref:wards(id, name, abbr),
  reporter:profiles!issues_reported_by_fkey(id, name),
  dri:profiles!issues_assigned_dri_fkey(id, name, phone, email),
  verifier:profiles!issues_verified_by_fkey(id, name),
  facility:facilities(id, name, facility_type),
  finding:finding_types(key, label)
`;

// Scoped to exactly what the Issues LIST table renders (code/category/description/state/lga/
// priority/status/DRI name/reported date — see issues/page.tsx) — no reporter/verifier/DRI
// contact info/ward, unlike ISSUE_SELECT above, which stays the full relation set for the Issue
// Detail page.
export const ISSUE_LIST_SELECT = `
  id, code, description, priority, status, reported_at, auto_generated,
  finding:finding_types(label),
  category:categories(name),
  state:states(name),
  lga:lgas(name),
  ward_ref:wards(name),
  facility:facilities(name),
  dri:profiles!issues_assigned_dri_fkey(name)
`;

/** The Findings Register's filters (URL params), shared with its CSV/JSON export so a download
 *  always matches the list on screen. `view` is a summary-card shortcut: open, critical (open and
 *  critical) or overdue (open past the Finding target). */
export interface IssueFilters {
  status?: string;
  priority?: string;
  category?: string;
  state?: string;
  lga?: string;
  search?: string;
  source?: string;
  type?: string;
  view?: string;
  /** The supervision visit that raised it (Risk-Based Supervision links here). */
  visit?: string;
}
export const ISSUE_FILTER_KEYS = ["status", "priority", "category", "state", "lga", "search", "source", "type", "view", "visit"] as const;

type Filterable<T> = {
  eq(column: string, value: string | boolean): T;
  in(column: string, values: readonly string[]): T;
  lt(column: string, value: string): T;
  or(filters: string): T;
};

export function applyIssueFilters<T extends Filterable<T>>(query: T, f: IssueFilters, targetDays: number, now: number): T {
  let q = query;
  if (f.status) q = q.eq("status", f.status);
  if (f.priority) q = q.eq("priority", f.priority);
  if (f.category) q = q.eq("category_id", f.category);
  if (f.state) q = q.eq("state_id", f.state);
  if (f.lga) q = q.eq("lga_id", f.lga);
  if (f.search) q = q.or(`description.ilike.%${f.search}%,code.ilike.%${f.search}%`);
  // RUTF auto-Findings (migration 0102): automatic vs registered by a person, and the rule.
  if (f.source === "auto") q = q.eq("auto_generated", true);
  else if (f.source === "manual") q = q.eq("auto_generated", false);
  if (f.type) q = q.eq("finding_type", f.type);
  if (f.visit) q = q.eq("visit_id", f.visit);
  if (f.view === "open" || f.view === "critical" || f.view === "overdue") q = q.in("status", OPEN_STATUSES);
  if (f.view === "critical") q = q.eq("priority", "critical");
  if (f.view === "overdue") q = q.lt("reported_at", new Date(now - targetDays * 86_400_000).toISOString());
  return q;
}

/** The Finding target in days (rutf_thresholds.finding_target_days, default 30). */
export async function getFindingTargetDays(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("rutf_thresholds").select("value").eq("key", "finding_target_days").limit(1).maybeSingle();
  return Number(data?.value ?? 30);
}

type IssueRow = Database["public"]["Tables"]["issues"]["Row"];

export type IssueWithRelations = IssueRow & {
  category: { id: string; name: string } | null;
  state: { id: string; name: string; code?: string | null } | null;
  lga: { id: string; name: string; abbr?: string | null } | null;
  ward_ref: { id: string; name: string; abbr?: string | null } | null;
  reporter: { id: string; name: string } | null;
  dri: { id: string; name: string; phone: string | null; email: string } | null;
  verifier: { id: string; name: string } | null;
  facility: { id: string; name: string; facility_type: string } | null;
  finding: { key: string; label: string } | null;
};

export type IssueListRow = Pick<IssueRow, "id" | "code" | "description" | "priority" | "status" | "reported_at" | "auto_generated"> & {
  finding: { label: string } | null;
  category: { name: string } | null;
  state: { name: string } | null;
  lga: { name: string } | null;
  ward_ref: { name: string } | null;
  facility: { name: string } | null;
  dri: { name: string } | null;
};

export const getIssueByCode = cache(async (client: SupabaseClient<Database>, code: string) => {
  const { data } = await client.from("issues").select(ISSUE_SELECT).eq("code", code).maybeSingle();
  return data as unknown as IssueWithRelations | null;
});

// cache()-wrapped: the Issue Detail page fetches this issue once for its own data and again
// implicitly whenever a sibling component on the same render needs it — memoizing per
// (client, id) means that costs one round trip, not one per call site.
export const getIssueById = cache(async (client: SupabaseClient<Database>, id: string) => {
  const { data } = await client.from("issues").select(ISSUE_SELECT).eq("id", id).maybeSingle();
  return data as unknown as IssueWithRelations | null;
});

export const getIssueHistory = cache(async (client: SupabaseClient<Database>, issueId: string) => {
  const { data } = await client
    .from("issue_history")
    .select("*")
    .eq("issue_id", issueId)
    .order("occurred_at", { ascending: true });
  return data ?? [];
});

export const getIssuePhotos = cache(async (client: SupabaseClient<Database>, issueId: string) => {
  const { data } = await client.from("issue_photos").select("*").eq("issue_id", issueId).order("uploaded_at");
  return data ?? [];
});

export interface IssueFilters {
  status?: string;
  category?: string;
  state?: string;
  priority?: string;
  search?: string;
}

export async function getFilteredIssues(client: SupabaseClient<Database>, filters: IssueFilters) {
  let query = client.from("issues").select(ISSUE_SELECT).order("reported_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status as IssueStatus);
  if (filters.priority) query = query.eq("priority", filters.priority as IssuePriority);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.state) query = query.eq("state_id", filters.state);
  if (filters.search) {
    const q = filters.search.trim();
    query = query.or(`description.ilike.%${q}%,code.ilike.%${q}%`);
  }

  const { data, error } = await query;
  return { data: (data ?? []) as unknown as IssueWithRelations[], error };
}

export async function getAllIssuesForScope(client: SupabaseClient<Database>) {
  // RLS already scopes this to the caller's project (or everything for
  // Super Admin / a global-scope profile) — no manual project filter needed.
  const { data } = await client.from("issues").select(ISSUE_SELECT).order("reported_at", { ascending: false });
  return (data ?? []) as unknown as IssueWithRelations[];
}
