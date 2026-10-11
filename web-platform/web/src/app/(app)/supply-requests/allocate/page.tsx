import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { AllocationPlan, type Plan } from "@/components/supply/AllocationPlan";

export const metadata: Metadata = { title: "Distribute to OTP centres" };

// The LGA allocation plan (DECISIONS R173; allocation guide §5): after RUTF arrives from the State,
// the LGA Nutrition Officer shares the store's usable stock across the Apex and satellite OTP
// centres by need — each centre's need for the coming week minus its usable stock — scaled down
// evenly when the store cannot cover every gap, so no centre runs out while another holds stock.
// Each line becomes an ordinary stock issue (lots earliest expiry first); the plan is saved.
export default async function AllocatePage() {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (profile.role !== "dri" || level !== "lga") redirect("/supply-requests");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_allocation_plan");
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link href="/supply-requests" style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> Supply Requests</Link>
        <h2 style={{ margin: "6px 0 2px" }}>Distribute to OTP centres</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          Share the store&apos;s stock across the Apex and satellite centres by need, so no centre runs out while another holds stock. Each
          centre&apos;s need for the coming week is worked out from its patients, new admissions and prescribed rations, minus the usable stock it
          already has. Adjust the quantities if you know better, then issue: each line is recorded as a stock issue and linked to the
          centre&apos;s approved request, if it has one.
        </p>
      </div>
      {error || !data
        ? <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>{error?.message ?? "The plan could not be loaded."}</div>
        : <AllocationPlan plan={data as unknown as Plan} />}
    </div>
  );
}
