import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { AccountabilityScorecard, type ScorecardRow, type TimeEfficiencyStats } from "@/components/accountability/AccountabilityScorecard";

export const metadata: Metadata = { title: "Accountability Scorecard" };

// Accountability Scorecard (DECISIONS R57) — loads the caller's Findings (RLS-scoped), the stage
// timings and the target; the view is components/accountability/AccountabilityScorecard.tsx.

/** The time "now" for ages and targets — read once per request (a server component). */
const requestTime = () => Date.now();

export default async function AccountabilityPage() {
  const supabase = await createClient();
  const [rowsRes, { data: statsRaw }, { data: target }, closures] = await Promise.all([
    (async () => {
      const out: ScorecardRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase
          .from("issues")
          .select("id, status, priority, reported_at, resolution_date, auto_generated, lga:lgas(id, name), facility:facilities(id, name), category:categories(name), dri:profiles!issues_assigned_dri_fkey(id, name)")
          .order("reported_at")
          .range(from, from + 999);
        out.push(...((data ?? []) as unknown as ScorecardRow[]));
        if (!data || data.length < 1000) return out;
      }
    })(),
    supabase.rpc("get_time_efficiency_stats"),
    supabase.from("rutf_thresholds").select("value").eq("key", "finding_target_days").limit(1).maybeSingle(),
    // When each Finding was verified and closed — for the score at each past month end (R109).
    (async () => {
      const at = new Map<string, string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from("issue_history").select("issue_id, occurred_at").eq("action", "Verified and closed")
          .order("occurred_at").range(from, from + 999);
        for (const h of data ?? []) at.set(h.issue_id, h.occurred_at);
        if (!data || data.length < 1000) return at;
      }
    })(),
  ]);
  return (
    <AccountabilityScorecard
      rows={rowsRes.map((r) => ({ ...r, closed_at: r.id ? closures.get(r.id) ?? null : null }))}
      stats={statsRaw as unknown as TimeEfficiencyStats | null}
      targetDays={Number(target?.value ?? 30)}
      now={requestTime()}
    />
  );
}
