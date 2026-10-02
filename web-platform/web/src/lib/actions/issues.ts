"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import type { IssuePriority } from "@/lib/types/database";

export type ActionResult = { error?: string } | { error?: undefined };

async function afterMutation(issueId: string) {
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/gis");
  revalidatePath("/subpanel");
  revalidatePath("/analytics");
}

export async function assignIssueAction(issueId: string, driId: string, note: string): Promise<ActionResult> {
  await getCurrentProfile(); // enforces auth; RLS/RPC enforce the role check itself
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_issue", { p_issue_id: issueId, p_dri_id: driId, p_note: note || null });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function approveAndAssignFindingAction(issueId: string, driId: string, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  if (!driId) return { error: "Select a DRI to assign this issue to." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_and_assign_finding", {
    p_issue_id: issueId,
    p_dri_id: driId,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function returnFindingForCorrectionAction(issueId: string, comment: string): Promise<ActionResult> {
  await getCurrentProfile();
  if (!comment.trim()) return { error: "Describe what needs correcting before returning this issue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_finding_for_correction", {
    p_issue_id: issueId,
    p_comment: comment,
  });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function submitDriResponseAction(issueId: string, response: string, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  if (!response.trim()) return { error: "Enter a response before submitting." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_dri_response", {
    p_issue_id: issueId,
    p_response: response,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function recordCorrectiveActionAction(issueId: string, actionTaken: string, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  if (!actionTaken.trim()) return { error: "Describe the corrective action before submitting." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_corrective_action", {
    p_issue_id: issueId,
    p_action_taken: actionTaken,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function verifyAndCloseIssueAction(issueId: string, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_and_close_issue", { p_issue_id: issueId, p_note: note || null });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function editIssueSubmissionAction(
  issueId: string,
  categoryId: string,
  priority: IssuePriority,
  description: string,
): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_issue_submission", {
    p_issue_id: issueId,
    p_category_id: categoryId,
    p_priority: priority,
    p_description: description,
  });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function deleteIssueSubmissionAction(issueId: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_issue_submission", { p_issue_id: issueId });
  if (error) return { error: error.message };
  await afterMutation(issueId);
  return {};
}

export async function createIssueAction(input: {
  categoryId: string;
  description: string;
  stateId: string;
  lgaId: string;
  wardId: string | null;
  ward: string | null;
  lat: number | null;
  lng: number | null;
  priority: IssuePriority;
}): Promise<ActionResult & { id?: string }> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .insert({
      category_id: input.categoryId,
      description: input.description,
      state_id: input.stateId,
      lga_id: input.lgaId,
      ward_id: input.wardId,
      ward: input.ward,
      lat: input.lat,
      lng: input.lng,
      priority: input.priority,
      project_id: profile.project_id,
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await afterMutation(data.id);
  return { id: data.id };
}
