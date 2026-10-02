import { Skeleton, SkeletonKpiCard, SkeletonTable } from "@/components/ui/Skeleton";

export default function TeamPerformanceLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Skeleton style={{ width: 260, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 320, height: 13 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>
      <SkeletonTable rows={5} columns={7} />
    </div>
  );
}
