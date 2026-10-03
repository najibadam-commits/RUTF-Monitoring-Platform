import { createClient } from "@/lib/supabase/server";
import { AccountabilityScorecard, type ScorecardRow, type TimeEfficiencyStats } from "@/components/accountability/AccountabilityScorecard";

// Accountability Scorecard (DECISIONS R57) — loads the caller's Findings (RLS-scoped), the stage
// timings and the target; the view is components/accountability/AccountabilityScorecard.tsx.

/** The time "now" for ages and targets — read once per request (a server component). */
const requestTime = () => Date.now();

export default async function AccountabilityPage() {
  const supabase = await createClient();
  const [rowsRes, { data: statsRaw }, { data: target }] = await Promise.all([
    (async () => {
      const out: ScorecardRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase
          .from("issues")
          .select("status, priority, reported_at, resolution_date, auto_generated, lga:lgas(name), category:categories(name), dri:profiles!issues_assigned_dri_fkey(id, name)")
          .order("reported_at")
          .range(from, from + 999);
        out.push(...((data ?? []) as unknown as ScorecardRow[]));
        if (!data || data.length < 1000) return out;
      }
    })(),
    supabase.rpc("get_time_efficiency_stats"),
    supabase.from("rutf_thresholds").select("value").eq("key", "finding_target_days").limit(1).maybeSingle(),
  ]);
  return (
    <AccountabilityScorecard
      rows={rowsRes}
      stats={statsRaw as unknown as TimeEfficiencyStats | null}
      targetDays={Number(target?.value ?? 30)}
      now={requestTime()}
    />
  );
}
