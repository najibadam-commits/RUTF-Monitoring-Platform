// Stat tiles and meters for the RUTF dashboard (brief §9). Values and labels wear text tokens;
// a status colour only ever appears with its icon and label (never colour alone), and a delta's
// colour says whether the change is good, not which way it went.

export type Status = "good" | "warning" | "critical";

const STATUS_STYLE: Record<Status, { color: string; icon: string }> = {
  good: { color: "var(--status-resolved)", icon: "ph-check-circle" },
  warning: { color: "var(--priority-high)", icon: "ph-warning" },
  critical: { color: "var(--priority-critical)", icon: "ph-warning-octagon" },
};

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-GB");
}

export function StatTile({
  label,
  value,
  unit,
  sub,
  delta,
  upIsGood,
  status,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  /** Change vs the previous month, already formatted with its sign (e.g. "+0.4 pts"). */
  delta?: { text: string; direction: -1 | 0 | 1 };
  /** Whether an increase is an improvement (colours the delta). */
  upIsGood?: boolean;
  status?: { level: Status; label: string };
  href?: string;
}) {
  const good = delta && delta.direction !== 0 ? (delta.direction > 0) === !!upIsGood : null;
  const body = (
    <>
      <div className="card-kicker" style={{ fontSize: 12, textTransform: "none", letterSpacing: 0, color: "var(--color-neutral-700)" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>
        {value}
        {unit && <span style={{ fontSize: 15, fontWeight: 600, marginLeft: 3, color: "var(--color-neutral-700)" }}>{unit}</span>}
      </div>
      {sub && <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 6, fontSize: 12 }}>
        {delta && (
          <span style={{ color: good === null ? "var(--color-neutral-600)" : good ? "var(--status-resolved)" : "var(--priority-critical)" }}>
            <i className={`ph ${delta.direction > 0 ? "ph-arrow-up-right" : delta.direction < 0 ? "ph-arrow-down-right" : "ph-minus"}`} aria-hidden="true" />{" "}
            {delta.text} <span className="text-muted">vs last month</span>
          </span>
        )}
        {status && (
          <span style={{ color: STATUS_STYLE[status.level].color, fontWeight: 600 }}>
            <i className={`ph-fill ${STATUS_STYLE[status.level].icon}`} aria-hidden="true" /> {status.label}
          </span>
        )}
      </div>
    </>
  );
  const style = { padding: 14, gap: 0, textDecoration: "none", color: "inherit" } as const;
  return href ? (
    <a href={href} className="card elev-sm" style={style}>{body}</a>
  ) : (
    <div className="card elev-sm" style={style}>{body}</div>
  );
}

/** A ratio against 100 %: fill in the accent, warning or critical by severity; track a lighter
 *  step of the same ramp so the state reads across the whole bar. */
export function Meter({ label, pct, sub, warnBelow, criticalBelow }: { label: string; pct: number | null; sub?: string; warnBelow: number; criticalBelow: number }) {
  const v = pct ?? 0;
  const level = pct === null ? null : v < criticalBelow ? "critical" : v < warnBelow ? "warning" : "good";
  const fill = level === "critical" ? "var(--priority-critical)" : level === "warning" ? "var(--priority-high)" : "var(--color-accent-600)";
  const track = level === "critical" ? "color-mix(in srgb, var(--priority-critical) 18%, transparent)"
    : level === "warning" ? "color-mix(in srgb, var(--priority-high) 20%, transparent)" : "var(--color-accent-100)";
  return (
    <div className="card elev-sm" style={{ padding: 14, gap: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 700 }}>{pct === null ? "—" : `${v.toFixed(1)}%`}</span>
      </div>
      <div role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}
        style={{ height: 8, borderRadius: 4, background: track, marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, v))}%`, height: "100%", background: fill, borderRadius: 4 }} />
      </div>
      {sub && <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>{sub}</div>}
      {level && level !== "good" && (
        <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600, color: fill }}>
          <i className={`ph-fill ${level === "critical" ? "ph-warning-octagon" : "ph-warning"}`} aria-hidden="true" />{" "}
          {level === "critical" ? `Below ${criticalBelow}%` : `Below ${warnBelow}%`}
        </div>
      )}
    </div>
  );
}
