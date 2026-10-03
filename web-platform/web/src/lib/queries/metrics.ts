import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { latestLedgerMonth, monthOf, type Month } from "@/lib/queries/kpis";

export type FacilityMetric = Database["public"]["Functions"]["facility_metrics"]["Returns"][number];

/** The month a report shows: ?month=YYYY-MM, else the latest month with ledger activity. */
export async function reportMonth(supabase: SupabaseClient<Database>, monthParam: string | undefined): Promise<Month> {
  return monthOf(/^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : await latestLedgerMonth(supabase));
}

/** facility_metrics() for a month, filtered by level and LGA (RLS scopes the facilities). */
export async function getFacilityMetrics(
  supabase: SupabaseClient<Database>,
  month: Month,
  filters: { level?: string; lga?: string },
): Promise<FacilityMetric[]> {
  const { data, error } = await supabase.rpc("facility_metrics", { p_start: month.start, p_end: month.end });
  if (error) {
    console.error("facility_metrics failed:", error.message);
    return [];
  }
  return (data ?? []).filter(
    (m) => (!filters.level || m.facility_type === filters.level) && (!filters.lga || m.lga_id === filters.lga),
  );
}
