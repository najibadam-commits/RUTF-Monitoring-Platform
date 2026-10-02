import type { CSSProperties } from "react";

/**
 * A single shimmering placeholder block, used to compose route-level loading.tsx skeletons that
 * approximate a page's real layout (see e.g. app/(app)/dashboard/loading.tsx). CSS-only — no
 * added dependency. Purely visual; does not affect data fetching.
 */
export function Skeleton({ style, className = "" }: { style?: CSSProperties; className?: string }) {
  return <div className={`skeleton ${className}`.trim()} style={style} />;
}

/** A KPI-card-shaped skeleton, matching the `.card.elev-sm` KPI tiles on Dashboard/Analytics. */
export function SkeletonKpiCard() {
  return (
    <div className="card elev-sm" style={{ gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton style={{ width: "55%", height: 10 }} />
        <Skeleton style={{ width: 16, height: 16, borderRadius: "50%" }} />
      </div>
      <Skeleton style={{ width: "40%", height: 34, marginTop: 2 }} />
      <Skeleton style={{ width: "70%", height: 9 }} />
    </div>
  );
}

/** A generic card-shaped skeleton (title bar + body block), for chart/list/map card slots. */
export function SkeletonCard({ height = 200 }: { height?: number }) {
  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <Skeleton style={{ width: "35%", height: 12 }} />
      <Skeleton style={{ width: "100%", height }} />
    </div>
  );
}

/** A `.table`-shaped skeleton — a header row + N placeholder rows, sized like a real table. */
export function SkeletonTable({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="card elev-sm" style={{ padding: 0 }}>
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, c) => (
              <th key={c}>
                <Skeleton style={{ width: "60%", height: 9 }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <td key={c}>
                  <Skeleton style={{ width: c === 0 ? "70%" : "85%", height: 11 }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
