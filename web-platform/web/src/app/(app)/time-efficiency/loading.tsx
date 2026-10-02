import { Skeleton, SkeletonKpiCard, SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";

export default function TimeEfficiencyLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Skeleton style={{ width: 240, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 340, height: 13 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
        <SkeletonCard height={140} />
        <SkeletonTable rows={4} columns={3} />
      </div>
    </div>
  );
}
