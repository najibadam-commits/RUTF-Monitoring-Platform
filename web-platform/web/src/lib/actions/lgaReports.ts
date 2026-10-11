"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string; id?: string };

const done = (id: string) => { revalidatePath(`/lga-reports/${id}`); revalidatePath("/lga-reports"); };

/** The LGA Nutrition Officer opens (creates if needed) their LGA's report for a week (lga_report_open
 *  takes the LGA from the account). */
export async function openLgaReportAction(weekStart: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_report_open", { p_week_start: weekStart });
  if (error) return { error: error.message };
  const id = (data as { id: string }).id;
  done(id);
  return { id };
}

export async function saveLgaCommentsAction(id: string, comments: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("lga_report_save_comments", { p_id: id, p_comments: comments });
  if (error) return { error: error.message };
  done(id);
  return {};
}

/** Submit to the State Nutrition Officer (lga_report_submit: the week is over, no OTP report is
 *  still waiting for review, sites without an accepted report are explained, the comparison is confirmed). */
export async function submitLgaReportAction(id: string, comments: string, confirmed: boolean, amendmentReason: string | null): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("lga_report_submit", { p_id: id, p_comments: comments || null, p_confirm_reviewed: confirmed, p_amendment_reason: amendmentReason });
  if (error) return { error: error.message };
  done(id);
  return {};
}

/** The LGA Nutrition Officer answers a query (back to the State for review) or reopens an
 *  accepted or rejected report for amendment. */
export async function lgaOfficerStepAction(id: string, action: "answer" | "reopen", note: string | null): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("lga_report_act", { p_id: id, p_action: action, p_note: note });
  if (error) return { error: error.message };
  done(id);
  return {};
}
