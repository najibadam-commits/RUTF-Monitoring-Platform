"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string } | { error?: undefined };

/** The State Nutrition Officer approves the draft clinical rule set (otp_rule_set_approve checks
 *  that the caller is an officer at a State store and that the review is confirmed). */
export async function approveRulesAction(version: string, note: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("otp_rule_set_approve", { p_version: version, p_confirm: true, p_note: note || null });
  if (error) return { error: error.message };
  revalidatePath("/clinical-rules");
  revalidatePath("/otp-caseload");
  return {};
}
