"use client";

import { useRouter } from "next/navigation";

export type DataSetTab = "facilities" | "lots" | "protocol" | "thresholds";

const TABS: { key: DataSetTab; label: string }[] = [
  { key: "facilities", label: "Facilities" },
  { key: "lots", label: "Lots" },
  { key: "protocol", label: "Dosing rules" },
  { key: "thresholds", label: "Thresholds" },
];

/** Switching tabs drops the other tab's filters and page. */
export function DataSetsTabs({ tab }: { tab: DataSetTab }) {
  const router = useRouter();
  return (
    <div className="seg" style={{ width: "fit-content", maxWidth: "100%", overflowX: "auto" }}>
      {TABS.map((t) => (
        <label className="seg-opt" key={t.key}>
          <input type="radio" checked={tab === t.key} onChange={() => router.push(t.key === "facilities" ? "/data-sets" : `/data-sets?tab=${t.key}`)} />
          {t.label}
        </label>
      ))}
    </div>
  );
}
