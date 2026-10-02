"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "./DashboardMapInner";

// Leaflet touches `window` at module init — must never run during SSR.
const DashboardMapInner = dynamic(() => import("./DashboardMapInner").then((m) => m.DashboardMapInner), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <i className="ph ph-circle-notch spin" style={{ fontSize: 20, color: "var(--color-accent)" }} />
    </div>
  ),
});

export function DashboardMap({ points }: { points: MapPoint[] }) {
  return <DashboardMapInner points={points} />;
}
