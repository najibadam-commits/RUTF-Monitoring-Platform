import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

// Month handling and the rutf_kpis() result shape shared by the RUTF dashboard and reports.

export type Kpis = {
  period: [string, string];
  stock_on_hand: Partial<Record<"state_store" | "lga_store" | "otp", number>>;
  months_of_stock: Partial<Record<"state_store" | "lga_store" | "otp", number | null>>;
  active_facilities: number;
  stockout_rate_pct: number | null;
  mean_stock_variance_pct: number | null;
  transfers_in_transit: number;
  transfers_with_discrepancy: number;
  short_dispensing_pct: number | null;
  otp_vf_median: number | null;
  otp_vf_outside_pct: number | null;
  dispensing_completeness_pct: number | null;
  count_on_time_pct: number | null;
  losses: { loss_damaged: number; loss_expired: number; loss_other: number };
  expired_on_hand: number;
  supervision_quarter: { visited: number; to_visit: number };
  open_critical_findings: number;
  open_findings: number;
  median_days_to_close: number | null;
};

export type Month = { key: string; start: string; end: string; label: string };

export function monthOf(key: string): Month {
  const [y, m] = key.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return {
    key,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function previousMonth(key: string): Month {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return monthOf(d.toISOString().slice(0, 7));
}

/** The month to show by default: the latest month with ledger activity the caller can see. */
export async function latestLedgerMonth(supabase: SupabaseClient<Database>): Promise<string> {
  const { data } = await supabase.from("stock_transactions").select("txn_date").order("txn_date", { ascending: false }).limit(1).maybeSingle();
  return (data?.txn_date ?? new Date().toISOString()).slice(0, 7);
}

export async function getKpis(supabase: SupabaseClient<Database>, month: Month): Promise<Kpis | null> {
  const { data, error } = await supabase.rpc("rutf_kpis", { p_start: month.start, p_end: month.end });
  if (error) {
    console.error("rutf_kpis failed:", error.message);
    return null;
  }
  return data as unknown as Kpis;
}
