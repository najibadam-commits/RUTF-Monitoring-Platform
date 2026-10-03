"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canVoidLedger } from "@/lib/rbac";

// Void one ledger submission with a reason (migration 0109). The database checks the role, the
// project and the reason again; this only spares a round trip for an obvious refusal.

export type VoidResult = {
  error?: string;
  kind?: string;
  rowsVoided?: number;
  transferCode?: string | null;
  transferStatus?: string | null;
  lotsBelowZero?: number;
  duplicate?: boolean;
};

export async function voidLedgerEntryAction(localId: string, reason: string): Promise<VoidResult> {
  const profile = await getCurrentProfile();
  if (!canVoidLedger(profile.role)) return { error: "Only an administrator can void a ledger entry." };
  if (reason.trim().length < 10) return { error: "Give the reason for voiding (at least 10 characters)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_ledger_submission", { p_local_id: localId, p_reason: reason.trim() });
  if (error) return { error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  revalidatePath("/stock-ledger");
  revalidatePath("/transfers");
  return {
    kind: r.kind as string,
    rowsVoided: r.rows_voided as number,
    transferCode: (r.transfer_code as string | null) ?? null,
    transferStatus: (r.transfer_status as string | null) ?? null,
    lotsBelowZero: (r.lots_below_zero as number) ?? 0,
    duplicate: r.duplicate === true,
  };
}
