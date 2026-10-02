import { IMPLEMENTATION_BY_STATE, IMPLEMENTATION_STATUS_META } from "@/lib/mock/implementation-monitoring";
import { tagBg } from "@/lib/constants";

export default function ImplementationMonitoringPage() {
  const totalPlanned = IMPLEMENTATION_BY_STATE.reduce((a, s) => a + s.planned, 0);
  const totalImplemented = IMPLEMENTATION_BY_STATE.reduce((a, s) => a + s.implemented, 0);
  const rate = totalPlanned ? Math.round((totalImplemented / totalPlanned) * 100) : 0;
  const behindCount = totalPlanned - totalImplemented;

  const kpiCards = [
    { label: "Sites Planned", value: totalPlanned, sub: "Across all monitored states", icon: "ph-target" },
    { label: "Sites Implemented", value: totalImplemented, sub: "Confirmed complete", icon: "ph-check-circle" },
    { label: "Implementation Rate", value: `${rate}%`, sub: "Implemented of planned", icon: "ph-chart-line-up" },
    { label: "Sites Behind Schedule", value: behindCount, sub: "Outstanding across all states", icon: "ph-warning" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Implementation Monitoring</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Field implementation progress by state, tracked against planned activity sites.
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
          Implementation by State
        </div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>State</th>
              <th style={{ textAlign: "right" }}>Planned</th>
              <th style={{ textAlign: "right" }}>Implemented</th>
              <th style={{ textAlign: "right" }}>Rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {IMPLEMENTATION_BY_STATE.map((s) => {
              const meta = IMPLEMENTATION_STATUS_META[s.status];
              const stateRate = s.planned ? Math.round((s.implemented / s.planned) * 100) : 0;
              return (
                <tr key={s.state}>
                  <td>{s.state}</td>
                  <td style={{ textAlign: "right" }}>{s.planned}</td>
                  <td style={{ textAlign: "right" }}>{s.implemented}</td>
                  <td style={{ textAlign: "right" }}>{stateRate}%</td>
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
