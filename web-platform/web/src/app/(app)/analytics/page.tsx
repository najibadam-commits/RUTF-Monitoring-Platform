import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";

function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("issues")
    .select(
      "id, status, reported_at, resolution_date, category:categories(name), dri:profiles!issues_assigned_dri_fkey(id, name), reporter:profiles!issues_reported_by_fkey(id, name)",
    );

  const rows = data ?? [];

  const now = new Date();
  const trendBars30 = Array.from({ length: 30 }, (_, idx) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (29 - idx));
    const key = d.toISOString().slice(0, 10);
    const count = rows.filter((r) => r.reported_at.startsWith(key)).length;
    return { key, count };
  });
  const trendMax = Math.max(1, ...trendBars30.map((d) => d.count));

  const categoryCounts = new Map<string, number>();
  rows.forEach((r) => {
    const name = (r.category as unknown as { name: string } | null)?.name ?? "No Sector";
    categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
  });
  const categoryBreakdown = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  const categoryMax = Math.max(1, ...categoryBreakdown.map(([, c]) => c));

  type Agg = { id: string; name: string; assigned: number; resolved: number; totalDays: number; resolvedCount: number };
  const driMap = new Map<string, Agg>();
  rows.forEach((r) => {
    const dri = r.dri as unknown as { id: string; name: string } | null;
    if (!dri) return;
    const entry = driMap.get(dri.id) ?? { id: dri.id, name: dri.name, assigned: 0, resolved: 0, totalDays: 0, resolvedCount: 0 };
    entry.assigned += 1;
    if (r.status === "verified_closed" || r.status === "resolved") entry.resolved += 1;
    if (r.resolution_date) {
      entry.totalDays += daysBetween(r.reported_at, r.resolution_date);
      entry.resolvedCount += 1;
    }
    driMap.set(dri.id, entry);
  });
  const driPerf = [...driMap.values()].sort((a, b) => b.assigned - a.assigned);

  type TpmAgg = { id: string; name: string; reported: number; verified: number };
  const tpmMap = new Map<string, TpmAgg>();
  rows.forEach((r) => {
    const reporter = r.reporter as unknown as { id: string; name: string } | null;
    if (!reporter) return;
    const entry = tpmMap.get(reporter.id) ?? { id: reporter.id, name: reporter.name, reported: 0, verified: 0 };
    entry.reported += 1;
    if (r.status === "verified_closed") entry.verified += 1;
    tpmMap.set(reporter.id, entry);
  });
  const tpmPerf = [...tpmMap.values()].sort((a, b) => b.reported - a.reported);

  const totalIssues = rows.length;
  const closedCount = rows.filter((r) => r.status === "verified_closed").length;
  const overallCloseRate = totalIssues ? Math.round((closedCount / totalIssues) * 100) : 0;
  const resolvedRows = rows.filter((r) => r.resolution_date);
  const avgResolutionDays = resolvedRows.length
    ? (resolvedRows.reduce((a, r) => a + daysBetween(r.reported_at, r.resolution_date as string), 0) / resolvedRows.length).toFixed(1)
    : "—";
  const activeDris = driMap.size;

  const kpiCards = [
    { label: "Total Issues", value: totalIssues, sub: "All time", icon: "ph-list-bullets" },
    { label: "Overall Close Rate", value: `${overallCloseRate}%`, sub: "Verified & closed", icon: "ph-check-circle" },
    { label: "Avg Resolution Time", value: avgResolutionDays === "—" ? "—" : `${avgResolutionDays}d`, sub: "Discovery to closure", icon: "ph-timer" },
    { label: "Active DRIs", value: activeDris, sub: "With at least one assignment", icon: "ph-users-three" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div>
        <h2 style={{ marginBottom: 2 }}>Analytics &amp; KPI Dashboard</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Aggregated performance across all monitored issues — {totalIssues} issue{totalIssues === 1 ? "" : "s"} tracked.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {kpiCards.map((card) => (
          <div className="card elev-sm" key={card.label} style={{ gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-kicker">{card.label}</span>
              <i className={`ph ${card.icon}`} style={{ color: "var(--color-accent)" }} />
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>{card.value}</div>
            <div className="card-meta">{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <div className="card elev-sm">
          <div className="card-title">Issues Reported — Last 30 Days</div>
          <div className="text-muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            Number of Issues
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 165, marginTop: 10 }}>
            {trendBars30.map((d) => (
              <div key={d.key} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: "var(--color-text)", visibility: d.count ? "visible" : "hidden" }}>{d.count}</span>
                <div title={String(d.count)} style={{ width: "100%", height: `${6 + (d.count / trendMax) * 90}%`, background: "var(--color-accent-500)", borderRadius: "2px 2px 0 0" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-title">Issues by Sector</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {categoryBreakdown.map(([name, count]) => (
              <div key={name}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                  <span>{name}</span>
                  <span className="text-muted">{count}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--color-neutral-800)" }}>
                  <div style={{ height: "100%", width: `${(count / categoryMax) * 100}%`, borderRadius: 3, background: "var(--color-accent-500)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="card elev-sm" style={{ padding: 0 }}>
          <div className="card-title" style={{ padding: "14px 16px 0" }}>
            DRI Performance
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>DRI</th>
                <th style={{ textAlign: "right" }}>Assigned</th>
                <th style={{ textAlign: "right" }}>Resolved</th>
                <th style={{ textAlign: "right" }}>Avg Days</th>
              </tr>
            </thead>
            <tbody>
              {driPerf.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td style={{ textAlign: "right" }}>{d.assigned}</td>
                  <td style={{ textAlign: "right" }}>{d.resolved}</td>
                  <td style={{ textAlign: "right" }}>{d.resolvedCount ? (d.totalDays / d.resolvedCount).toFixed(1) : "—"}</td>
                </tr>
              ))}
              {driPerf.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 16 }}>
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card elev-sm" style={{ padding: 0 }}>
          <div className="card-title" style={{ padding: "14px 16px 0" }}>
            RUTF Monitoring Performance
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>TPM</th>
                <th style={{ textAlign: "right" }}>Reported</th>
                <th style={{ textAlign: "right" }}>Verified</th>
                <th style={{ textAlign: "right" }}>Close Rate</th>
              </tr>
            </thead>
            <tbody>
              {tpmPerf.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td style={{ textAlign: "right" }}>{t.reported}</td>
                  <td style={{ textAlign: "right" }}>{t.verified}</td>
                  <td style={{ textAlign: "right" }}>{t.reported ? Math.round((t.verified / t.reported) * 100) : 0}%</td>
                </tr>
              ))}
              {tpmPerf.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 16 }}>
                    No reports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
