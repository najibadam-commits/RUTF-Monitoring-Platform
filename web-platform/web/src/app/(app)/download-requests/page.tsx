import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessDownloadRequests, canReviewDownloadRequests } from "@/lib/rbac";
import { getDownloadRequests, getMyDownloadRequests } from "@/lib/queries/downloadRequests";
import { getAllCategories, getLgas, getStates } from "@/lib/queries/lookups";
import { describeScope, type ScopeNames } from "@/lib/downloadResources";
import { DownloadRequestsTable } from "@/components/downloadRequests/DownloadRequestsTable";
import { MyDownloadRequests } from "@/components/downloadRequests/MyDownloadRequests";

export const metadata: Metadata = { title: "Data Access Requests" };

// Data Access Requests (DECISIONS R93): data leaves the platform for a Viewer only after an
// administrator approves it, and an approved file can be downloaded once. Each request's scope is
// written out in words here, with names looked up for the ids in its filters.

export default async function DownloadRequestsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessDownloadRequests(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const reviewer = canReviewDownloadRequests(profile.role);

  // RLS (download_requests_select / _select_project_admin — migration 0036) scopes the review list
  // to everything for Super Admin, or the caller's own project for Project Admin; a Viewer sees only
  // their own requests.
  const [requests, states, categories, lgas, { data: types }] = await Promise.all([
    reviewer ? getDownloadRequests(supabase) : getMyDownloadRequests(supabase),
    getStates(supabase),
    getAllCategories(supabase),
    getLgas(supabase),
    supabase.from("finding_types").select("key, label"),
  ]);
  const names: ScopeNames = Object.fromEntries([
    ...states.map((s) => [s.id, s.name]),
    ...categories.map((c) => [c.id, c.name]),
    ...lgas.map((l) => [l.id, l.name]),
    ...(types ?? []).map((t) => [t.key, t.label]),
  ]);
  const withScope = requests.map((r) => ({ ...r, scope: describeScope(r.filters, names) }));

  return reviewer ? <DownloadRequestsTable requests={withScope} /> : <MyDownloadRequests requests={withScope} />;
}
