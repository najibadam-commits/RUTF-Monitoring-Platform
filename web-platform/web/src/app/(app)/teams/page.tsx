import { redirect } from "next/navigation";
import { TEAMS } from "@/lib/mock/teams";
import { tagBg } from "@/lib/constants";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessTeams } from "@/lib/rbac";

const TEAM_STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--status-resolved)" },
  inactive: { label: "Inactive", color: "var(--priority-critical)" },
};

export default async function TeamsPage() {
  const profile = await getCurrentProfile();
  if (!canAccessTeams(profile.role)) redirect("/dashboard");

  const totalTeams = TEAMS.length;
  const totalMembers = TEAMS.reduce((a, t) => a + t.memberCount, 0);
  const avgTeamSize = totalTeams ? (totalMembers / totalTeams).toFixed(1) : "—";
  const devicesAssigned = TEAMS.reduce((a, t) => a + t.devicesAssigned, 0);

  const kpiCards = [
    { label: "Total Teams", value: totalTeams, sub: "Across all projects", icon: "ph-users" },
    { label: "Total Members", value: totalMembers, sub: "Field officers & DRIs", icon: "ph-user-circle" },
    { label: "Avg Team Size", value: avgTeamSize, sub: "Members per team", icon: "ph-chart-bar" },
    { label: "Devices Assigned", value: devicesAssigned, sub: "Across all teams", icon: "ph-device-mobile" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Teams</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Field team rosters, leads, and device assignments.
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
          Team Roster
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Project</th>
              <th>Lead</th>
              <th style={{ textAlign: "right" }}>Members</th>
              <th style={{ textAlign: "right" }}>Devices Assigned</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {TEAMS.map((t) => {
              const meta = TEAM_STATUS_META[t.status];
              return (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="text-muted">{t.project}</td>
                  <td className="text-muted">{t.lead}</td>
                  <td style={{ textAlign: "right" }}>{t.memberCount}</td>
                  <td style={{ textAlign: "right" }}>{t.devicesAssigned}</td>
                  <td>
                    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>
                      {meta.label}
                    </span>
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
