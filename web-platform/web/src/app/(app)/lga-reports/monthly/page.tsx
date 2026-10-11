import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { canAccessLgaReports } from "@/lib/rbac";
import type { MonthFigures } from "@/components/supply/NeedCalculation";

export const metadata: Metadata = { title: "LGA Monthly Figures" };

// Each LGA's monthly figures for the State (DECISIONS R173; allocation guide §2): patients at the
// start, new admissions, discharges, other outcomes, patients at the end and RUTF stock — from the
// OTP weekly reports the LGA Nutrition Officer accepted, weeks starting in the month. The same
// figures travel with the LGA's request to the State store. lga_monthly_overview() scopes the LGAs.

type Row = MonthFigures & { lga_id: string; lga: string };
const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB"));

function months(k: number): string[] {
  const now = new Date();
  return Array.from({ length: k }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}
const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function LgaMonthlyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (!canAccessLgaReports(profile.role, level)) redirect("/dashboard");
  const sp = await searchParams;
  const list = months(7);
  const month = sp.month && list.includes(sp.month) ? sp.month : list[1];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lga_monthly_overview", { p_month: `${month}-01` });
  const rows = ((data as unknown as { lgas: Row[] } | null)?.lgas ?? []);
  const sum = (k: keyof MonthFigures) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const cols: [keyof MonthFigures, string][] = [
    ["patients_start", "At the start"], ["new_admissions", "New admissions"], ["discharged_cured", "Cured"], ["defaulted", "Defaulted"], ["died", "Died"],
    ["transferred_or_other", "Transferred / other"], ["patients_end", "At the end"], ["otp_stock_end", "RUTF at OTP centres"], ["store_stock_end", "RUTF at the LGA store"],
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link href="/lga-reports" style={{ fontSize: 12.5 }}><i className="ph ph-arrow-left" /> LGA Weekly Reports</Link>
        <h2 style={{ margin: "6px 0 2px" }}>LGA monthly figures</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          Patients at the start of the month + new admissions − discharges and other outcomes = patients at the end, with the RUTF stock, for each LGA.
          From the weekly OTP reports the LGA Nutrition Officer accepted (weeks starting in the month). The State allocates on these figures; they are
          attached to each LGA&apos;s request to the State store.
        </p>
      </div>
      <form className="filter-bar" method="get">
        <select className="input" name="month" defaultValue={month} aria-label="Month" style={{ maxWidth: 220 }}>
          {list.map((m, i) => <option key={m} value={m}>{label(m)}{i === 0 ? " (so far)" : ""}</option>)}
        </select>
        <button className="btn btn-secondary" type="submit"><i className="ph ph-funnel" /> Apply</button>
      </form>
      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the figures: {error.message}</div>}
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>LGA</th><th style={{ textAlign: "right" }}>Centres reporting</th>{cols.map(([, h]) => <th key={h} style={{ textAlign: "right" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lga_id}>
                <td>{r.lga}</td><td style={{ textAlign: "right" }}>{r.sites_reporting} of {r.otp_sites}</td>
                {cols.map(([k]) => <td key={k} style={{ textAlign: "right" }}>{r.weeks_reported || k === "store_stock_end" ? n(r[k] as number) : "—"}</td>)}
              </tr>
            ))}
            {rows.length > 1 && (
              <tr style={{ fontWeight: 700 }}><td>All LGAs</td><td style={{ textAlign: "right" }}>{sum("sites_reporting")} of {sum("otp_sites")}</td>
                {cols.map(([k]) => <td key={k} style={{ textAlign: "right" }}>{n(sum(k))}</td>)}</tr>
            )}
            {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No LGAs in your area.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
