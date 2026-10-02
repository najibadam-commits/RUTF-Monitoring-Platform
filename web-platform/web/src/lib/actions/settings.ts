"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessSettings } from "@/lib/rbac";
import type { Database } from "@/lib/types/database";

type SettingsUpdate = Database["public"]["Tables"]["settings"]["Update"];

export async function updateSettingsAction(patch: SettingsUpdate): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!canAccessSettings(profile.role)) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.from("settings").update({ ...patch, updated_by: profile.id }).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}
