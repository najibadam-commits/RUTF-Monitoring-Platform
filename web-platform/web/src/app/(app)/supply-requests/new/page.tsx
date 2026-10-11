import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { NewSupplyRequestForm, type SupplyForm } from "@/components/supply/NewSupplyRequestForm";

export const metadata: Metadata = { title: "New supply request" };

// The LGA Nutrition Officer's request to the State store (DECISIONS R170). The facility and its
// supplier come from the account (supply_request_form), never from the page, so a request is
// always for the user's own LGA store. OTP Officers make theirs in the app.
export default async function NewSupplyRequestPage() {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (profile.role !== "dri" || level !== "lga") redirect("/supply-requests");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supply_request_form");
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div>
        <Link href="/supply-requests" style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> Supply Requests</Link>
        <h2 style={{ margin: "6px 0 2px" }}>Request stock from the State store</h2>
      </div>
      {error || !data
        ? <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>{error?.message ?? "The form could not be loaded."}</div>
        : <NewSupplyRequestForm form={data as unknown as SupplyForm} />}
    </div>
  );
}
