"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string } | { error?: undefined };
export type ReportKind = "otp" | "lga";
export type ReviewAction = "accept" | "return" | "reject" | "query";

const path = (kind: ReportKind, id: string) => (kind === "otp" ? `/weekly-reports/${id}` : `/lga-reports/${id}`);
const list = (kind: ReportKind) => (kind === "otp" ? "/weekly-reports" : "/lga-reports");

/** A review step on a weekly report (DECISIONS R171). OTP report: the LGA Nutrition Officer
 *  accepts or rejects; they or the State Coordinator query or return (otp_report_decide /
 *  otp_report_act). LGA report: the State Nutrition Officer accepts or rejects; they or the State
 *  Coordinator query or return (lga_report_act). The database checks the role, the LGA or state,
 *  the status and that a note is given where one is needed. */
export async function reviewReportAction(kind: ReportKind, id: string, action: ReviewAction, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  let error;
  if (kind === "otp") {
    if (action === "query") ({ error } = await supabase.rpc("otp_report_act", { p_report_id: id, p_action: "query", p_note: note }));
    else ({ error } = await supabase.rpc("otp_report_decide", {
      p_report_id: id, p_decision: action === "accept" ? "approved" : action === "return" ? "returned" : "rejected", p_note: note || null,
    }));
  } else {
    ({ error } = await supabase.rpc("lga_report_act", { p_id: id, p_action: action, p_note: note || null }));
  }
  if (error) return { error: error.message };
  revalidatePath(path(kind, id));
  revalidatePath(list(kind));
  return {};
}

/** Opening a submitted report marks it "under review" (the reviewer only; anything else is left as it is). */
export async function startReviewAction(kind: ReportKind, id: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = kind === "otp"
    ? await supabase.rpc("otp_report_start_review", { p_report_id: id })
    : await supabase.rpc("lga_report_act", { p_id: id, p_action: "start_review", p_note: null });
  if (error) return { error: error.message };
  revalidatePath(path(kind, id));
  revalidatePath(list(kind));
  return {};
}
