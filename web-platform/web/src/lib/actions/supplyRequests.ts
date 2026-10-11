"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import type { Json } from "@/lib/types/database";

export type ActionResult = { error?: string; id?: string };

/** The LGA Nutrition Officer asks the State store for stock (supply_request_create checks the
 *  role, takes the facility and its supplier from the account — never from the form — and
 *  records the balance and the last 30 days' use at the moment of asking). */
export async function createSupplyRequestAction(input: {
  lines: { product_id: string; requested_qty: number; stockout_days: number | null }[];
  justification: string; needed_by: string | null; local_id: string;
}): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supply_request_create", { p: input as unknown as Json });
  if (error) return { error: error.message };
  revalidatePath("/supply-requests");
  return { id: (data as { id: string }).id };
}

/** A step on a supply request (DECISIONS R170): start_review, query, approve, reject (the
 *  supplying store's officer); respond, cancel (the requester); comment (either store, the State
 *  Coordinator, a Supervisor). supply_request_act checks who may do what, the status, and that a
 *  query, rejection, answer or changed quantity carries its note. */
export async function actOnSupplyRequestAction(id: string, action: string, note: string | null, lines: { product_id: string; approved_qty?: number; requested_qty?: number }[] | null): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("supply_request_act", { p_id: id, p_action: action, p_note: note, p_lines: lines as unknown as Json });
  if (error) return { error: error.message };
  revalidatePath(`/supply-requests/${id}`);
  revalidatePath("/supply-requests");
  return {};
}

/** The LGA Nutrition Officer issues the allocation plan: one stock issue per centre, lots earliest
 *  expiry first (lga_allocation_issue checks the role, the centres and the usable stock). */
export async function issueAllocationAction(input: { lines: { facility_id: string; sachets: number }[]; note: string; document_no: string; local_id: string }): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_allocation_issue", { p: input as unknown as Json });
  if (error) return { error: error.message };
  revalidatePath("/supply-requests/allocate");
  revalidatePath("/supply-requests");
  return { id: (data as { id: string }).id };
}

/** Marks the LGA's Apex OTP centre (set_apex_otp: the LGA or State Nutrition Officer, or an administrator). */
export async function setApexAction(facilityId: string): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_apex_otp", { p_facility_id: facilityId });
  if (error) return { error: error.message };
  revalidatePath("/supply-requests/allocate");
  return {};
}
