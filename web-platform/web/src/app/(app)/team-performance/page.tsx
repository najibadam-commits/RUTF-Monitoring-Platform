import { TEAMS } from "@/lib/mock/teams";
import { ActiveStatusTag } from "@/components/ui/Tags";

export default function TeamPerformancePage() {
  const totalTeams = TEAMS.length;
  const avgResponseHours = totalTeams ? TEAMS.reduce((a, t) => a + t.avgResponseHours, 0) / totalTeams : 0;
  const avgResolutionRate = totalTeams ? TEAMS.reduce((a, t) => a + t.resolutionRate, 0) / totalTeams : 0;
  const avgDeviceUtilization = totalTeams ? TEAMS.reduce((a, t) => a + t.deviceUtilization, 0) / totalTeams : 0;

  const kpiCards = [
    { label: "Teams Tracked", value: totalTeams, sub: "Across all projects", icon: "ph-users" },
    { label: "Avg Response Time", value: `${avgResponseHours.toFixed(1)}h`, sub: "Assignment to first response", icon: "ph-timer" },
    { label: "Avg Resolution Rate", value: `${Math.round(avgResolutionRate)}%`, sub: "Assigned issues resolved", icon: "ph-check-circle" },
    { label: "Avg Device Utilization", value: `${Math.round(avgDeviceUtilization)}%`, sub: "Devices actively syncing", icon: "ph-device-mobile" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Team Performance Report</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Per-team response times, resolution rates, and device utilization.
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
          Team Performance
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Project</th>
              <th>Lead</th>
              <th style={{ textAlign: "right" }}>Avg Response Time</th>
              <th style={{ textAlign: "right" }}>Resolution Rate</th>
              <th style={{ textAlign: "right" }}>Device Utilization</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {TEAMS.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td className="text-muted">{t.project}</td>
                <td className="text-muted">{t.lead}</td>
                <td style={{ textAlign: "right" }}>{t.avgResponseHours.toFixed(1)}h</td>
                <td style={{ textAlign: "right" }}>{t.resolutionRate}%</td>
                <td style={{ textAlign: "right" }}>{t.deviceUtilization}%</td>
                <td>
                  <ActiveStatusTag status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
