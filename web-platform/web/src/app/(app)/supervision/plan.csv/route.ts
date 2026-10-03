import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { monthOf, latestLedgerMonth } from "@/lib/queries/kpis";

// Supervision Planner export (brief §9): the suggested visits per supervisor as CSV, for their
// task list. Same rows as the Planner tab (supervision_plan(), RLS-scoped to the caller).

const LEVEL: Record<string, string> = { state_store: "State store", lga_store: "LGA store", health_facility: "OTP site" };
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: NextRequest) {
  await getCurrentProfile();
  const supabase = await createClient();
  const params = request.nextUrl.searchParams;
  const key = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : await latestLedgerMonth(supabase);
  const month = monthOf(key);
  const lga = params.get("lga");
  const [{ data, error }, { data: lgas }] = await Promise.all([
    supabase.rpc("supervision_plan", { p_as_of: month.end }),
    supabase.from("lgas").select("id, name"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lgaName = Object.fromEntries((lgas ?? []).map((l) => [l.id, l.name]));
  const rows = (data ?? []).filter((r) => r.suggested && (!lga || r.lga_id === lga));
  const header = ["supervisor", "rank", "facility", "level", "lga", "risk_score", "last_visit", "days_since_visit", "why"];
  const csv = [header.join(","), ...rows.map((r) => [r.supervisor_name, r.rank, r.facility_name, LEVEL[r.facility_type], lgaName[r.lga_id],
    r.risk_score, r.last_visit_date, r.days_since_visit, r.reason].map(cell).join(","))].join("\n");
  return new NextResponse(csv + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="supervision-plan-${month.key}.csv"`,
    },
  });
}
