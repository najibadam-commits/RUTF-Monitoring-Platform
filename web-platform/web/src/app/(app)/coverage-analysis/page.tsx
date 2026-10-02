import {
  COVERAGE_BY_STATE,
  LGAS_COVERED_MOCK,
  STATES_COVERED_MOCK,
  TOTAL_LGAS,
  TOTAL_STATES,
  TOTAL_WARDS,
  WARDS_COVERED_MOCK,
} from "@/lib/mock/coverage-analysis";

export default function CoverageAnalysisPage() {
  const overallPct = Math.round((WARDS_COVERED_MOCK / TOTAL_WARDS) * 100);
  const coverageMax = Math.max(1, ...COVERAGE_BY_STATE.map((s) => s.coveragePct));

  const kpiCards = [
    { label: "States Covered", value: `${STATES_COVERED_MOCK}/${TOTAL_STATES}`, sub: "At least one visit recorded", icon: "ph-flag" },
    { label: "LGAs Covered", value: `${LGAS_COVERED_MOCK}/${TOTAL_LGAS}`, sub: "At least one visit recorded", icon: "ph-map-trifold" },
    { label: "Wards Covered", value: `${WARDS_COVERED_MOCK}/${TOTAL_WARDS}`, sub: "At least one visit recorded", icon: "ph-map-pin" },
    { label: "Overall Coverage", value: `${overallPct}%`, sub: "Of all monitored wards", icon: "ph-globe-hemisphere-west" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <h2 style={{ margin: 0 }}>Coverage Analysis</h2>
          <span className="tag tag-outline">Preview · Sample Data</span>
        </div>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Geographic coverage of monitoring activity against Nigeria&apos;s administrative hierarchy.
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

      <div className="card elev-sm">
        <div className="card-title">Coverage by State</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {COVERAGE_BY_STATE.map((s) => (
            <div key={s.state}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span>{s.state}</span>
                <span className="text-muted">{s.coveragePct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--color-neutral-800)" }}>
                <div style={{ height: "100%", width: `${(s.coveragePct / coverageMax) * 100}%`, borderRadius: 3, background: "var(--color-accent-500)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
