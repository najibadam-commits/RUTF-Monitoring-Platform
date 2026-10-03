import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/lib/constants";
import type { IssuePriority } from "@/lib/types/database";

interface TimeEfficiencyStats {
  avg_report_to_assign_hours: number | null;
  avg_assign_to_response_hours: number | null;
  avg_response_to_corrective_hours: number | null;
  avg_corrective_to_verify_hours: number | null;
  by_priority: { priority: IssuePriority; resolved_count: number; avg_days: number | null }[];
}

function fmtHours(h: number | null) {
  return h == null ? "—" : `${h}h`;
}

export default async function TimeEfficiencyPage() {
  const supabase = await createClient();
  const { data: statsRaw } = await supabase.rpc("get_time_efficiency_stats");
  const stats = statsRaw as unknown as TimeEfficiencyStats | null;

  const stages = [
    { key: "report_to_assign", label: "Report → Assignment", hours: stats?.avg_report_to_assign_hours ?? null },
    { key: "assign_to_response", label: "Assignment → Response", hours: stats?.avg_assign_to_response_hours ?? null },
    { key: "response_to_corrective", label: "Response → Corrective Action", hours: stats?.avg_response_to_corrective_hours ?? null },
    { key: "corrective_to_verify", label: "Corrective Action → Verification", hours: stats?.avg_corrective_to_verify_hours ?? null },
  ];
  const stageMax = Math.max(1, ...stages.map((s) => s.hours ?? 0));

  const byPriorityMap = new Map((stats?.by_priority ?? []).map((p) => [p.priority, p]));
  const priorityRows = PRIORITY_ORDER.map((p) => ({
    priority: p,
    resolvedCount: byPriorityMap.get(p)?.resolved_count ?? 0,
    avgDays: byPriorityMap.get(p)?.avg_days ?? null,
  }));

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <RealtimeRefresher table="issue_history" />
      <div>
        <h2 style={{ marginBottom: 2 }}>Time Efficiency Analysis</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Average time a Finding spends at each stage, from being raised to being verified and closed.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {stages.map((s) => (
          <div className="card elev-sm" key={s.key} style={{ gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-kicker">{s.label}</span>
              <i className="ph ph-timer" style={{ color: "var(--color-accent)" }} />
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>
              {fmtHours(s.hours)}
            </div>
            <div className="card-meta">Average across all issues</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
        <div className="card elev-sm">
          <div className="card-title">Stage Duration Comparison</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {stages.map((s) => (
              <div key={s.key}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span>{s.label}</span>
                  <span className="text-muted">{fmtHours(s.hours)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--color-neutral-800)" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${((s.hours ?? 0) / stageMax) * 100}%`,
                      borderRadius: 3,
                      background: "var(--color-accent-500)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card elev-sm" style={{ padding: 0 }}>
          <div className="card-title" style={{ padding: "14px 16px 0" }}>
            By Priority
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Priority</th>
                <th style={{ textAlign: "right" }}>Resolved</th>
                <th style={{ textAlign: "right" }}>Avg Total Time</th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map((r) => (
                <tr key={r.priority}>
                  <td>{PRIORITY_LABEL[r.priority]}</td>
                  <td style={{ textAlign: "right" }}>{r.resolvedCount}</td>
                  <td style={{ textAlign: "right" }}>{r.avgDays == null ? "—" : `${r.avgDays}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
