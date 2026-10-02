import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_COLOR, STATUS_ORDER } from "@/lib/constants";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { StatusDot } from "@/components/ui/Tags";
import { DashboardMap } from "@/components/gis/DashboardMap";
import Link from "next/link";
import type { IssueStatus } from "@/lib/types/database";

interface DashboardStats {
  total: number;
  by_status: Partial<Record<IssueStatus, number>>;
  avg_resolution_days: number | null;
  trend_14d: { day: string; count: number }[];
  by_state: { name: string; cnt: number }[];
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // Four independent round trips, run concurrently: the aggregate RPC (KPIs, donut, 14-day
  // trend, state breakdown — all computed server-side in SQL, not by fetching every issue row
  // and looping in JS), a lean lat/lng/status-only query for the map thumbnail, and the
  // existing bounded Recent Issues / Timeline queries.
  const [{ data: statsRaw }, { data: mapRows }, { data: recentIssuesRaw }, { data: timelineRaw }] = await Promise.all([
    supabase.rpc("get_dashboard_stats"),
    supabase.from("issues").select("lat, lng, status").not("lat", "is", null).not("lng", "is", null),
    supabase
      .from("issues")
      .select("id, code, status, category:categories(name), state:states(name)")
      .order("reported_at", { ascending: false })
      .limit(6),
    supabase
      .from("issue_history")
      .select("id, occurred_at, actor_label, action, note, issue:issues(code)")
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  const stats = statsRaw as unknown as DashboardStats;
  const total = stats?.total ?? 0;
  const byStatus = stats?.by_status ?? {};
  const countByStatus = (s: IssueStatus) => byStatus[s] ?? 0;
  const kNew = countByStatus("new");
  const kAssigned = countByStatus("assigned");
  const kProgress = countByStatus("in_progress");
  const kResolved = countByStatus("resolved");
  const kVerified = countByStatus("verified_closed");
  const pending = kNew + kAssigned + kProgress;
  const avgRes = stats?.avg_resolution_days == null ? "—" : stats.avg_resolution_days.toFixed(1);

  const kpiCards = [
    { label: "Total Findings", value: total, sub: "All time", icon: "ph-list-bullets", color: "var(--color-accent)" },
    { label: "New", value: kNew, sub: "Awaiting assignment", icon: "ph-sparkle", color: STATUS_COLOR.new },
    { label: "Assigned", value: kAssigned, sub: "Routed to DRI", icon: "ph-user-plus", color: STATUS_COLOR.assigned },
    { label: "In Progress", value: kProgress, sub: "Corrective action underway", icon: "ph-wrench", color: STATUS_COLOR.in_progress },
    { label: "Resolved", value: kResolved, sub: "Awaiting verification", icon: "ph-check", color: STATUS_COLOR.resolved },
    { label: "Verified / Closed", value: kVerified, sub: "Confirmed complete", icon: "ph-check-circle", color: STATUS_COLOR.verified_closed },
    { label: "Pending", value: pending, sub: "Open across all stages", icon: "ph-hourglass", color: "var(--priority-high)" },
    { label: "Avg Resolution", value: avgRes === "—" ? "—" : `${avgRes}d`, sub: "Discovery to closure", icon: "ph-timer", color: "var(--color-accent)" },
  ];

  // 14-day trend — computed server-side (SQL), just relabeled here for display. `day` comes
  // back as a plain YYYY-MM-DD (UTC) date; label is its day-of-month, parsed as UTC to match.
  const trendBars = (stats?.trend_14d ?? []).map((d) => ({
    key: d.day,
    label: new Date(`${d.day}T00:00:00Z`).getUTCDate(),
    count: d.count,
  }));
  const trendMax = Math.max(1, ...trendBars.map((d) => d.count));

  const donutSegs = STATUS_ORDER.map((s) => ({ status: s, count: countByStatus(s), color: STATUS_COLOR[s] }));

  const stateBreakdown = (stats?.by_state ?? []).map((s) => ({ name: s.name, count: s.cnt }));
  const stateMax = Math.max(1, ...stateBreakdown.map((s) => s.count));

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <RealtimeRefresher table="issues" />
      <div>
        <h2 style={{ marginBottom: 2 }}>Operations Overview</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Live snapshot across all monitored states — {total} findings tracked.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {kpiCards.map((card) => (
          <div className="card elev-sm" key={card.label} style={{ gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-kicker">{card.label}</span>
              <i className={`ph ${card.icon}`} style={{ color: card.color }} />
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>{card.value}</div>
            <div className="card-meta">{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
            <div className="card-title">Live Finding Map</div>
            <Link href="/gis" style={{ fontSize: 12.5 }}>
              Open full map <i className="ph ph-arrow-right" />
            </Link>
          </div>
          <div style={{ position: "relative", height: 260, margin: 12, borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <DashboardMap
              points={(mapRows ?? [])
                .filter((r) => r.lat && r.lng)
                .map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), color: STATUS_COLOR[r.status as IssueStatus] }))}
            />
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Findings Reported — Last 14 Days</div>
          <div className="text-muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            Number of Findings
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 168, marginTop: 10 }}>
            {trendBars.map((d) => (
              <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--color-text)" }}>{d.count}</span>
                <div title={String(d.count)} style={{ width: "100%", height: `${6 + (d.count / trendMax) * 90}%`, background: "var(--color-accent-500)", borderRadius: "2px 2px 0 0" }} />
                <div className="text-muted" style={{ fontSize: 9 }}>
                  {d.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 14 }}>
        <div className="card elev-sm">
          <div className="card-title">Findings by Status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {donutSegs.map((seg) => (
              <div key={seg.status} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: seg.color, flex: "none" }} />
                <span style={{ flex: 1 }}>{STATUS_LABEL[seg.status]}</span>
                <span className="text-muted">{seg.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Findings by State</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {stateBreakdown.map((s) => (
              <div key={s.name}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span>{s.name}</span>
                  <span className="text-muted">{s.count}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--color-neutral-800)" }}>
                  <div style={{ height: "100%", width: `${(s.count / stateMax) * 100}%`, borderRadius: 3, background: "var(--color-accent-500)" }} />
                </div>
              </div>
            ))}
            {stateBreakdown.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>No findings yet.</div>}
          </div>
        </div>
        <div className="card elev-sm">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="card-title">Recent Findings</div>
            <Link href="/issues" style={{ fontSize: 12.5 }}>
              View all
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
            {(recentIssuesRaw ?? []).map((i) => (
              <Link
                key={i.id}
                href={`/issues/${i.id}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)", cursor: "pointer", textDecoration: "none", color: "inherit" }}
              >
                <StatusDot status={i.status as IssueStatus} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(i.category as unknown as { name: string } | null)?.name ?? "—"}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {i.code} · {(i.state as unknown as { name: string } | null)?.name ?? "—"}
                  </div>
                </div>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  {STATUS_LABEL[i.status as IssueStatus]}
                </span>
              </Link>
            ))}
            {(recentIssuesRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No findings reported yet.</div>}
          </div>
        </div>
      </div>

      <div className="card elev-sm">
        <div className="card-title">Activity &amp; Resolution Timeline</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {(timelineRaw ?? []).map((h) => (
            <div key={h.id} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: "1px solid var(--color-divider)" }}>
              <div className="text-muted" style={{ fontSize: 11, width: 130, flex: "none" }}>
                {new Date(h.occurred_at).toLocaleString()}
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong style={{ fontWeight: 500 }}>{h.action}</strong> — {h.note}
              </div>
              <div className="text-muted" style={{ fontSize: 11, width: 150, flex: "none", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {(h.issue as unknown as { code: string } | null)?.code} · {h.actor_label}
              </div>
            </div>
          ))}
          {(timelineRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No activity yet.</div>}
        </div>
      </div>
    </div>
  );
}
