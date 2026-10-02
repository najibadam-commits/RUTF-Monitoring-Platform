import { Skeleton } from "@/components/ui/Skeleton";

export default function GisLoading() {
  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, gap: 0 }}>
      <div style={{ width: 300, flex: "none", padding: 16, borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton style={{ width: "70%", height: 16 }} />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} style={{ width: "100%", height: 34 }} />
        ))}
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <Skeleton style={{ position: "absolute", inset: 0, borderRadius: 0 }} />
      </div>
    </div>
  );
}
