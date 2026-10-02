interface ReportCard {
  icon: string;
  title: string;
  description: string;
  actions:
    | { kind: "links"; items: { label: string; href: string }[] }
    | { kind: "comingSoon" };
}

const REPORT_CARDS: ReportCard[] = [
  {
    icon: "ph-list-bullets",
    title: "Issue Data Export",
    description: "Export every tracked issue — status, priority, location, and full workflow history — as CSV or JSON.",
    actions: {
      kind: "links",
      items: [
        { label: "Export CSV", href: "/issues/export" },
        { label: "Export JSON", href: "/issues/export?format=json" },
      ],
    },
  },
  {
    icon: "ph-file-text",
    title: "Post Implementation Report",
    description: "Completed-project outcome summaries and their generated report history.",
    actions: { kind: "links", items: [{ label: "View Reports", href: "/post-implementation-report" }] },
  },
  {
    icon: "ph-map-pin-area",
    title: "Coverage Analysis Report",
    description: "A printable summary of geographic coverage across states, LGAs, and wards.",
    actions: { kind: "comingSoon" },
  },
  {
    icon: "ph-chart-bar",
    title: "Team Performance Report",
    description: "Per-team response times, resolution rates, and device utilization.",
    actions: { kind: "links", items: [{ label: "View Report", href: "/team-performance" }] },
  },
  {
    icon: "ph-clipboard-text",
    title: "Implementation Monitoring Report",
    description: "A state-by-state implementation progress summary, exportable for stakeholders.",
    actions: { kind: "comingSoon" },
  },
  {
    icon: "ph-database",
    title: "Data Sets Export",
    description: "Export the full Settlement and Activity Site lists synced to the field app.",
    actions: { kind: "comingSoon" },
  },
];

export default function ReportingPage() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Reporting &amp; Export Centre</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Generate and download reports across the platform.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {REPORT_CARDS.map((card) => (
          <div className="card elev-sm" key={card.title} style={{ gap: 10, justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34, height: 34, borderRadius: 9, flex: "none",
                    display: "grid", placeItems: "center", background: "var(--color-accent-100)",
                  }}
                >
                  <i className={`ph ${card.icon}`} style={{ fontSize: 16, color: "var(--color-accent-700)" }} />
                </div>
                <div className="card-title" style={{ fontSize: 15 }}>
                  {card.title}
                </div>
              </div>
              <p className="card-body" style={{ margin: 0 }}>
                {card.description}
              </p>
            </div>

            {card.actions.kind === "links" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {card.actions.items.map((item) => (
                  <a key={item.href} className="btn btn-secondary" href={item.href}>
                    <i className="ph ph-download-simple" />
                    {item.label}
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn btn-secondary" disabled title="Not yet available">
                  <i className="ph ph-download-simple" /> Export
                </button>
                <span className="tag tag-outline">Coming Soon</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
