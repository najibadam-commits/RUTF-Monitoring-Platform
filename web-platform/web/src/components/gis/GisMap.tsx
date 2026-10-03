"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { GisMapInner } from "./GisMapInner";
export type { GisFacility } from "./GisMapInner";

const Inner = dynamic(() => import("./GisMapInner").then((m) => m.GisMapInner), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <i className="ph ph-circle-notch spin" style={{ fontSize: 24, color: "var(--color-accent)" }} />
    </div>
  ),
});

export function GisMap(props: ComponentProps<typeof GisMapInner>) {
  return <Inner {...props} />;
}
