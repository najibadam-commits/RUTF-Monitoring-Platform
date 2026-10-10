"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string } | { error?: undefined };

/** The State Coordinator approves, returns or rejects a submitted weekly report (otp_report_decide
 *  checks the role, the state, that the report is waiting, and that a return or rejection has a note). */
export async function decideWeeklyReportAction(reportId: string, decision: "approved" | "returned" | "rejected", note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("otp_report_decide", { p_report_id: reportId, p_decision: decision, p_note: note || null });
  if (error) return { error: error.message };
  revalidatePath(`/weekly-reports/${reportId}`);
  revalidatePath("/weekly-reports");
  return {};
}

/** The State Coordinator opens a submitted report: it becomes "under review" (otp_report_start_review
 *  checks the role and the state; any other status is left as it is). */
export async function startWeeklyReportReviewAction(reportId: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("otp_report_start_review", { p_report_id: reportId });
  if (error) return { error: error.message };
  revalidatePath(`/weekly-reports/${reportId}`);
  revalidatePath("/weekly-reports");
  return {};
}
