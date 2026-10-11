"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";

export type ActionResult = { error?: string };

/** Runs data retention now (or previews it): retention_run checks the Super Admin. */
export async function runRetentionAction(dryRun: boolean): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("retention_run", { p_dry_run: dryRun });
  if (error) return { error: error.message };
  revalidatePath("/data-retention");
  return {};
}

/** Sets a rule to delete, report only, or off (retention_set_mode checks the Super Admin; audited). */
export async function setRetentionModeAction(key: string, mode: "delete" | "report" | "off"): Promise<ActionResult> {
  await getCurrentProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("retention_set_mode", { p_key: key, p_mode: mode });
  if (error) return { error: error.message };
  revalidatePath("/data-retention");
  return {};
}
