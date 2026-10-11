import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getOfficerLevel } from "@/lib/supabase/dal";
import { canAccessSupplyRequests } from "@/lib/rbac";
import { SUPPLY_STATUS, type SupplyRow } from "@/components/supply/supplyStatus";

export const metadata: Metadata = { title: "Supply Requests" };

// Supply Requests (DECISIONS R170): OTP site -> LGA store (made by the OTP Officer in the app) and
// LGA store -> State store (made by the LGA Nutrition Officer here). The officer at the supplying
// store reviews: approve (with the quantity), query, or reject. Approval moves no stock: the
// store issues as usual (Issue Stock in the app) and the transfer is linked to the request, which
// becomes dispatched, then received when the receipt is recorded. supply_request_list() scopes
// the rows to the user's jurisdiction (0134).

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-GB"));
const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

export default async function SupplyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [profile, level] = await Promise.all([getCurrentProfile(), getOfficerLevel()]);
  if (!canAccessSupplyRequests(profile.role, level)) redirect("/dashboard");
  const sp = await searchParams;
  const isStore = profile.role === "dri";
  const box = sp.box === "incoming" || sp.box === "outgoing" ? sp.box : isStore ? "incoming" : "all";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supply_request_list", { p_box: box, p_status: null });
  const all = (data ?? []) as unknown as SupplyRow[];
  const status = sp.status && SUPPLY_STATUS[sp.status] ? sp.status : null;
  const level2 = sp.level === "otp_to_lga" || sp.level === "lga_to_state" ? sp.level : null;
  const rows = all.filter((r) => (!status || r.status === status) && (!level2 || r.level === level2));
  const count = (st: string[]) => all.filter((r) => st.includes(r.status)).length;
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ box, status, level: level2, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/supply-requests?${p.toString()}`;
  };
  const tiles: { key: string; label: string; value: number; sub: string }[] = [
    { key: "submitted", label: "Waiting for review", value: count(["submitted"]), sub: "New or answered" },
    { key: "under_review", label: "Under review", value: count(["under_review"]), sub: "Opened, no decision yet" },
    { key: "queried", label: "Queried", value: count(["queried"]), sub: "Waiting for the requester" },
    { key: "approved", label: "Approved, not yet sent", value: count(["approved"]), sub: "Dispatch through Issue Stock" },
    { key: "partially_fulfilled", label: "Partly sent", value: count(["partially_fulfilled"]), sub: "More to dispatch" },
    { key: "dispatched", label: "Dispatched", value: count(["dispatched"]), sub: "In transit" },
    { key: "received", label: "Received", value: count(["received"]), sub: "Receipt recorded" },
    { key: "rejected", label: "Rejected", value: count(["rejected"]), sub: "With the reason" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ marginBottom: 2 }}>Supply Requests</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
            OTP sites ask their LGA store for RUTF (from the app); LGA stores ask the State store (here). The officer at the supplying store approves
            the quantity, queries the request or rejects it. Approving moves no stock: the store then records the issue as usual and the transfer is
            linked to the request automatically, which becomes dispatched, then received when the receipt is recorded. The State Coordinator and
            Supervisors see the requests in their area and may add technical advice.
          </p>
        </div>
        {level === "lga" && <Link className="btn btn-primary" href="/supply-requests/new"><i className="ph ph-plus" /> Request from the State store</Link>}
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
        {isStore && (
          <>
            <Link className={`btn ${box === "incoming" ? "btn-primary" : "btn-secondary"}`} href={qs({ box: "incoming", status: null })}>
              {level === "state" ? "From LGA stores" : "From OTP sites"}
            </Link>
            {level === "lga" && <Link className={`btn ${box === "outgoing" ? "btn-primary" : "btn-secondary"}`} href={qs({ box: "outgoing", status: null })}>My requests to the State store</Link>}
          </>
        )}
        <Link className={`btn ${box === "all" ? "btn-primary" : "btn-secondary"}`} href={qs({ box: "all", status: null })}>Everything in my area</Link>
        {box === "all" && (
          <>
            <span className="text-muted" style={{ alignSelf: "center", fontSize: 13, marginLeft: 8 }}>Level:</span>
            <Link className={`btn btn-ghost`} href={qs({ level: null })} style={{ fontWeight: level2 ? 400 : 700 }}>Both</Link>
            <Link className={`btn btn-ghost`} href={qs({ level: "otp_to_lga" })} style={{ fontWeight: level2 === "otp_to_lga" ? 700 : 400 }}>OTP → LGA</Link>
            <Link className={`btn btn-ghost`} href={qs({ level: "lga_to_state" })} style={{ fontWeight: level2 === "lga_to_state" ? 700 : 400 }}>LGA → State</Link>
          </>
        )}
      </div>

      {error && <div className="card elev-sm" style={{ color: "var(--priority-critical)" }}>Could not load the requests: {error.message}</div>}

      <div className="kpi-row">
        {tiles.map((t) => (
          <Link key={t.key} href={qs({ status: status === t.key ? null : t.key })} className="card elev-sm kpi-card"
            style={{ textDecoration: "none", color: "inherit", outline: status === t.key ? "2px solid var(--color-accent)" : undefined }}>
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value">{t.value.toLocaleString("en-GB")}</div>
            <div className="kpi-sub">{status === t.key ? "Filtered · click to clear" : t.sub}</div>
          </Link>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Request</th><th>From</th><th>To</th><th>Status</th>
              <th style={{ textAlign: "right" }}>Asked (sachets)</th><th style={{ textAlign: "right" }}>Approved</th><th style={{ textAlign: "right" }}>Sent</th>
              <th>Submitted</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = SUPPLY_STATUS[r.status] ?? { label: r.status, colour: "var(--color-neutral-600)" };
              return (
                <tr key={r.id}>
                  <td><b>{r.code}</b><div className="text-muted" style={{ fontSize: 12 }}>{r.level === "lga_to_state" ? "LGA → State" : "OTP → LGA"}{r.resubmitted_count ? ` · resubmitted ${r.resubmitted_count}×` : ""}</div></td>
                  <td>{r.from_name}<div className="text-muted" style={{ fontSize: 12 }}>{r.from_lga} LGA</div></td>
                  <td>{r.to_name}</td>
                  <td><span style={{ color: st.colour, fontWeight: 600 }}>● {st.label}</span></td>
                  <td style={{ textAlign: "right" }}>{fmt(r.requested_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.approved_qty)}</td>
                  <td style={{ textAlign: "right" }}>{r.dispatched_qty ? fmt(r.dispatched_qty) : "—"}</td>
                  <td className="text-muted" style={{ fontSize: 12.5 }}>{fmtDay(r.submitted_at)}</td>
                  <td><Link href={`/supply-requests/${r.id}`}>{r.i_review && ["submitted", "under_review"].includes(r.status) ? "Review" : "Open"}</Link></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No supply requests match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
