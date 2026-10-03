import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_COLOR, STATUS_FILTER_OPTIONS } from "@/lib/constants";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { StatusDot } from "@/components/ui/Tags";
import { DashboardMap } from "@/components/gis/DashboardMap";
import { KpiSections } from "@/components/dashboard/KpiSections";
import { getKpis, latestLedgerMonth, monthOf, previousMonth } from "@/lib/queries/kpis";
import type { IssueStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Command Centre" };

// RUTF dashboard (brief §9): the headline KPIs for a month from rutf_kpis() (migrations
// 0105/0106 — the same definitions test-kpis.js checks against hand-calculated values), then the
// Findings map, status, recent Findings and activity. RLS scopes everything to the viewer.

interface DashboardStats {
  total: number;
  by_status: Partial<Record<IssueStatus, number>>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient();
  const sp = await searchParams;
  const monthKey = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : await latestLedgerMonth(supabase);
  const month = monthOf(monthKey);
  const prevMonth = previousMonth(monthKey);

  const [k, p, { data: statsRaw }, { data: mapRows }, { data: recentIssuesRaw }, { data: timelineRaw }] = await Promise.all([
    getKpis(supabase, month),
    getKpis(supabase, prevMonth),
    supabase.rpc("get_dashboard_stats"),
    supabase.from("issues").select("lat, lng, status").not("lat", "is", null).not("lng", "is", null),
    supabase.from("issues").select("id, code, status, auto_generated, finding:finding_types(label), category:categories(name)")
      .order("reported_at", { ascending: false }).limit(6),
    supabase.from("issue_history").select("id, occurred_at, actor_label, action, note, issue:issues(code)")
      .order("occurred_at", { ascending: false }).limit(8),
  ]);
  const stats = statsRaw as unknown as DashboardStats;
  const byStatus = stats?.by_status ?? {};

  // Month choices: the last 12 months.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1 + 6 - i, 1));
    return monthOf(d.toISOString().slice(0, 7));
  }).filter((m) => m.start <= new Date().toISOString().slice(0, 10));


  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <RealtimeRefresher table="issues" />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Command Centre</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            The RUTF pipeline at a glance — State store → LGA stores → OTP sites · {month.label} ·{" "}
            {k ? `${k.active_facilities} stores and OTP sites reporting` : "No data for this month"}
          </p>
        </div>
        <form method="get" style={{ display: "flex", gap: 8 }}>
          <select className="input" name="month" defaultValue={monthKey} aria-label="Month" style={{ minWidth: 170 }}>
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">Show</button>
        </form>
      </div>

      <KpiSections k={k} p={p} monthLabel={month.label} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 14 }}>
        <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
            <div className="card-title">Findings map</div>
            <Link href="/gis" style={{ fontSize: 12.5 }}>Open full map <i className="ph ph-arrow-right" /></Link>
          </div>
          <div style={{ position: "relative", height: 260, margin: 12, borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <DashboardMap
              points={(mapRows ?? []).filter((r) => r.lat && r.lng)
                .map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), color: STATUS_COLOR[r.status as IssueStatus] }))}
            />
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Findings by status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {STATUS_FILTER_OPTIONS.map((s) => (
              <a key={s} href={`/issues?status=${s}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, textDecoration: "none", color: "inherit" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[s], flex: "none" }} />
                <span style={{ flex: 1 }}>{STATUS_LABEL[s]}</span>
                <span className="text-muted">{byStatus[s] ?? 0}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)", gap: 14 }}>
        <div className="card elev-sm">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="card-title">Recent Findings</div>
            <Link href="/issues" style={{ fontSize: 12.5 }}>View all</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
            {(recentIssuesRaw ?? []).map((i) => (
              <Link key={i.id} href={`/issues/${i.id}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)", textDecoration: "none", color: "inherit" }}>
                <StatusDot status={i.status as IssueStatus} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(i.finding as unknown as { label: string } | null)?.label ?? (i.category as unknown as { name: string } | null)?.name ?? "—"}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{i.code}{i.auto_generated ? " · automatic check" : ""}</div>
                </div>
                <span className="text-muted" style={{ fontSize: 11 }}>{STATUS_LABEL[i.status as IssueStatus]}</span>
              </Link>
            ))}
            {(recentIssuesRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No Findings yet.</div>}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Activity</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {(timelineRaw ?? []).map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: "1px solid var(--color-divider)" }}>
                <div className="text-muted" style={{ fontSize: 11, width: 120, flex: "none" }}>{new Date(h.occurred_at).toLocaleString("en-GB")}</div>
                <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                  <strong style={{ fontWeight: 500 }}>{h.action}</strong> — {h.note}
                  <div className="text-muted" style={{ fontSize: 11 }}>{(h.issue as unknown as { code: string } | null)?.code} · {h.actor_label}</div>
                </div>
              </div>
            ))}
            {(timelineRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
