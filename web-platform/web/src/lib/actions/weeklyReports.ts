"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string } | { error?: undefined };

/** The State Coordinator approves or returns a submitted weekly report (otp_report_decide checks
 *  the role, the state, that the report is waiting, and that a return has a note). */
export async function decideWeeklyReportAction(reportId: string, decision: "approved" | "returned", note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("otp_report_decide", { p_report_id: reportId, p_decision: decision, p_note: note || null });
  if (error) return { error: error.message };
  revalidatePath(`/weekly-reports/${reportId}`);
  revalidatePath("/weekly-reports");
  return {};
}
