import Link from "next/link";
import type { ReactNode } from "react";
import { monthOf } from "@/lib/queries/kpis";

// Shared frame for the RUTF analysis pages (brief §9): title, month picker and filters as a plain
// GET form (works without JS, shareable URLs), and a level/LGA filter on facility rows.

export type SP = Record<string, string | undefined>;

export function monthChoices(current: string, count = 12) {
  const today = new Date().toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 1 + 6 - i, 1));
    return monthOf(d.toISOString().slice(0, 7));
  }).filter((m) => m.start <= today);
}

export function ReportShell({
  title,
  intro,
  monthKey,
  lgas,
  sp,
  showLevel = true,
  extraFilters,
  children,
}: {
  title: string;
  intro: ReactNode;
  monthKey: string;
  lgas?: { id: string; name: string }[];
  sp: SP;
  showLevel?: boolean;
  extraFilters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>{title}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 820 }}>{intro}</p>
      </div>
      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <select className="input" name="month" defaultValue={monthKey} aria-label="Month" style={{ maxWidth: 180 }}>
          {monthChoices(monthKey).map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {showLevel && (
          <select className="input" name="level" defaultValue={sp.level ?? ""} aria-label="Level" style={{ maxWidth: 160 }}>
            <option value="">All levels</option>
            <option value="state_store">State store</option>
            <option value="lga_store">LGA stores</option>
            <option value="health_facility">OTP sites</option>
          </select>
        )}
        {lgas && (
          <select className="input" name="lga" defaultValue={sp.lga ?? ""} aria-label="LGA" style={{ maxWidth: 170 }}>
            <option value="">All LGAs</option>
            {lgas.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        {extraFilters}
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
      </form>
      {children}
    </div>
  );
}

export function SummaryTiles({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
      {items.map((i) => (
        <div key={i.label} className="card elev-sm" style={{ padding: 14, gap: 0 }}>
          <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>{i.label}</div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 700 }}>{i.value}</div>
          {i.sub && <div className="text-muted" style={{ fontSize: 12 }}>{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** A flag cell: icon + text, never colour alone. */
export function Flag({ level, children }: { level: "warning" | "critical"; children: ReactNode }) {
  const color = level === "critical" ? "var(--priority-critical)" : "var(--priority-high)";
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
      <i className={`ph-fill ${level === "critical" ? "ph-warning-octagon" : "ph-warning"}`} aria-hidden="true" /> {children}
    </span>
  );
}

export function FacilityLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/stock-ledger?facility=${id}`} style={{ fontWeight: 500 }}>{name}</Link>;
}

export const LEVEL_LABEL: Record<string, string> = { state_store: "State store", lga_store: "LGA store", health_facility: "OTP site" };
export const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
