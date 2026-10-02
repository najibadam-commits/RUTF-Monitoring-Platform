import {
  AVG_COMPLETION_DAYS_MOCK,
  PROJECTS_COMPLETED_MOCK,
  RECENT_REPORTS,
  SUCCESS_RATE_PCT_MOCK,
} from "@/lib/mock/post-implementation-report";
import { tagBg } from "@/lib/constants";

const REPORT_STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "var(--priority-high)" },
  final: { label: "Final", color: "var(--status-resolved)" },
};

export default function PostImplementationReportPage() {
  const kpiCards = [
    { label: "Projects Completed", value: PROJECTS_COMPLETED_MOCK, sub: "All time", icon: "ph-check-circle" },
    { label: "Avg Completion Time", value: `${AVG_COMPLETION_DAYS_MOCK}d`, sub: "Start to closeout", icon: "ph-timer" },
    { label: "Overall Success Rate", value: `${SUCCESS_RATE_PCT_MOCK}%`, sub: "Verified & closed out", icon: "ph-trophy" },
    { label: "Reports Generated", value: RECENT_REPORTS.length, sub: "In the last quarter", icon: "ph-file-text" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Post Implementation Report</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Completed-project outcome summaries and exportable reports.
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

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          Recent Reports
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Report</th>
              <th>Project</th>
              <th>Generated</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {RECENT_REPORTS.map((r) => {
              const meta = REPORT_STATUS_META[r.status];
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="text-muted">{r.project}</td>
                  <td className="text-muted">{new Date(r.generatedAt).toLocaleDateString()}</td>
                  <td>
                    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="table-actions">
                    <button className="btn btn-icon btn-ghost" title="Export not yet available" disabled>
                      <i className="ph ph-download-simple" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
