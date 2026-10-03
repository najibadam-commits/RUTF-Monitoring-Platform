import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getIssueById, getIssueHistory, getIssuePhotos } from "@/lib/queries/issues";
import { getCategories, getDris } from "@/lib/queries/lookups";
import { canAssign, canEditOrDeleteIssue, canRecordCorrective, canRespond, canReviewFinding, canVerify, isViewer } from "@/lib/rbac";
import { IssueDetailClient } from "@/components/issues/IssueDetailClient";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";

export const metadata: Metadata = { title: "Finding detail" };

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // getCurrentProfile() (the signed-in viewer, used below only for permission flags — not a
  // redirect gate) doesn't depend on the issue, and getIssueById() doesn't depend on the
  // profile — run them concurrently instead of paying for both round trips back to back.
  const [profile, issue] = await Promise.all([getCurrentProfile(), getIssueById(supabase, id)]);
  if (!issue) notFound();

  const [history, photos, categories, dris, sectorDris] = await Promise.all([
    getIssueHistory(supabase, id),
    getIssuePhotos(supabase, id),
    getCategories(supabase),
    getDris(supabase),
    // Scoped to the finding's own sector — the State Coordinator's approve-and-assign picker
    // must only offer a DRI who can actually see this finding afterward (see DECISIONS.md #22).
    getDris(supabase, issue.category_id),
  ]);

  const signedPhotos = await Promise.all(
    photos.map(async (p) => {
      const { data } = await supabase.storage.from("issue-evidence").createSignedUrl(p.storage_path, 3600);
      return { ...p, url: data?.signedUrl ?? null };
    }),
  );

  const isAssignedDri = issue.assigned_dri === profile.id;
  const isAwaitingReview = issue.status === "pending_review" || issue.status === "returned_for_correction";
  // Super Admin can review any state/project; a State Coordinator only their own managed state; a
  // Project Admin only their own project — matches the RLS scoping already in place
  // (issues_update's project_admin branch, issues_update_state_coordinator) and the
  // approve_and_assign_finding/return_finding_for_correction/edit_issue_submission RPCs' own
  // checks (see DECISIONS.md #29).
  const isReviewerForThisIssue =
    profile.role === "super_admin" ||
    (profile.role === "state_coordinator" && profile.managed_state_id === issue.state_id) ||
    // Mirrors in_scope()'s own null-passthrough exactly (a Project Admin with no project_id set
    // sees everything, same as every other Project Admin capability in this codebase) — not a
    // stricter client-side check that could hide the button for a case the server would allow.
    (profile.role === "project_admin" && (profile.project_id === null || profile.project_id === issue.project_id));
  const permissions = {
    isViewer: isViewer(profile.role),
    isSuperAdmin: profile.role === "super_admin",
    canAssign: canAssign(profile.role) && issue.status === "new",
    canReview: canReviewFinding(profile.role) && isReviewerForThisIssue && isAwaitingReview,
    canRespond: canRespond(profile.role, isAssignedDri) && issue.status === "assigned",
    canCorrective: canRecordCorrective(profile.role, isAssignedDri) && issue.status === "in_progress",
    canVerify: canVerify(profile.role) && issue.status === "resolved",
    canEditOrDelete: canEditOrDeleteIssue(profile.role),
  };

  return (
    <>
      <RealtimeRefresher table="issue_history" />
      <IssueDetailClient
        issue={issue}
        history={history}
        photos={signedPhotos}
        categories={categories}
        dris={dris}
        sectorDris={sectorDris}
        permissions={permissions}
      />
    </>
  );
}
