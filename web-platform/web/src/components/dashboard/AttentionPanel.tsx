import type { Kpis } from "@/lib/queries/kpis";

// Command Centre "Needs attention" list (DECISIONS R82): the month's KPIs turned into actions, most
// serious first, each linking to the page where it is dealt with. Thresholds are the same ones the
// KPI tiles below colour by. Severity always shows as icon + label, never colour alone.

type Level = "critical" | "warning";
type Item = { level: Level; icon: string; text: string; action: string; href: string };

const LEVEL_STYLE: Record<Level, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--priority-critical)", bg: "color-mix(in srgb, var(--priority-critical) 10%, transparent)", label: "Critical" },
  warning: { color: "var(--priority-high)", bg: "color-mix(in srgb, var(--priority-high) 10%, transparent)", label: "Warning" },
};

const LEVELS = [
  { key: "state_store", label: "State store", type: "state_store" },
  { key: "lga_store", label: "LGA stores", type: "lga_store" },
  { key: "otp", label: "OTP sites", type: "health_facility" },
] as const;

const n = (v: number) => v.toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

export function attentionItems(k: Kpis, pastTarget: number, targetDays: number): Item[] {
  const items: Item[] = [];
  if (k.open_critical_findings > 0)
    items.push({ level: "critical", icon: "ph-warning-octagon", text: `${plural(k.open_critical_findings, "critical Finding")} open`, action: "Review", href: "/issues?view=critical" });
  if (k.expired_on_hand > 0)
    items.push({ level: "critical", icon: "ph-calendar-x", text: `${plural(k.expired_on_hand, "expired sachet")} still on hand`, action: "Remove from stock", href: "/stock-ledger?flag=expired" });
  if (pastTarget > 0)
    items.push({ level: "warning", icon: "ph-hourglass-medium", text: `${plural(pastTarget, "Finding")} open past the ${targetDays}-day target`, action: "Follow up", href: "/issues?view=overdue" });
  for (const l of LEVELS) {
    const mos = k.months_of_stock[l.key];
    if (mos !== null && mos !== undefined && mos < 1)
      items.push({ level: "warning", icon: "ph-package", text: `${l.label}: ${mos.toFixed(1)} months of stock left`, action: "Plan re-supply", href: `/stock-ledger?type=${l.type}` });
  }
  if ((k.stockout_rate_pct ?? 0) > 0)
    items.push({ level: "warning", icon: "ph-prohibit", text: `${Number(k.stockout_rate_pct).toFixed(1)}% of stores and OTP sites had a stockout day`, action: "See where", href: "/stock-ledger?flag=stockout" });
  if (k.transfers_with_discrepancy > 0)
    items.push({ level: "warning", icon: "ph-truck", text: `${plural(k.transfers_with_discrepancy, "transfer")} received with a discrepancy`, action: "Reconcile", href: "/transfers?status=discrepancy" });
  if ((k.short_dispensing_pct ?? 0) > 5)
    items.push({ level: "warning", icon: "ph-hand-heart", text: `Short-dispensing at ${Number(k.short_dispensing_pct).toFixed(1)}%, above the 5% limit`, action: "Check OTPs", href: "/otp-dispensing" });
  const coverage = k.supervision_quarter.to_visit > 0 ? (k.supervision_quarter.visited * 100) / k.supervision_quarter.to_visit : null;
  if (coverage !== null && coverage < 80)
    items.push({ level: coverage < 50 ? "critical" : "warning", icon: "ph-clipboard-text", text: `Supervision coverage ${coverage.toFixed(0)}% this quarter (target 80%)`, action: "Plan visits", href: "/supervision" });
  if (k.dispensing_completeness_pct !== null && Number(k.dispensing_completeness_pct) < 90)
    items.push({ level: Number(k.dispensing_completeness_pct) < 75 ? "critical" : "warning", icon: "ph-check-square-offset", text: `Daily dispensing reported for ${Number(k.dispensing_completeness_pct).toFixed(0)}% of OTP-weeks (target 90%)`, action: "Chase reports", href: "/reporting-completeness" });
  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

export function AttentionPanel({ k, pastTarget, targetDays, monthLabel }: { k: Kpis; pastTarget: number; targetDays: number; monthLabel: string }) {
  const items = attentionItems(k, pastTarget, targetDays);
  return (
    <div className="card elev-sm" style={{ padding: 16, gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ph-fill ph-bell-ringing" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> Needs attention
        </div>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {items.length ? `${plural(items.length, "item")} for ${monthLabel}, most serious first` : monthLabel}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--status-resolved)", fontWeight: 600 }}>
          <i className="ph-fill ph-check-circle" aria-hidden="true" /> All clear: no stock, reporting or Finding issues need action.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
          {items.map((it) => {
            const st = LEVEL_STYLE[it.level];
            return (
              <li key={it.text}>
                <a href={it.href} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--radius-md)", background: st.bg, textDecoration: "none", color: "inherit", height: "100%" }}>
                  <i className={`ph-fill ${it.icon}`} aria-hidden="true" style={{ color: st.color, fontSize: 20, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    <span style={{ color: st.color, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 6 }}>{st.label}</span>
                    {it.text}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
                    {it.action} <i className="ph ph-arrow-right" aria-hidden="true" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
