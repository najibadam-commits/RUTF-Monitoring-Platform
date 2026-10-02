import { Skeleton, SkeletonKpiCard, SkeletonCard } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Skeleton style={{ width: 220, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 300, height: 13 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <SkeletonCard height={260} />
        <SkeletonCard height={168} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 14 }}>
        <SkeletonCard height={140} />
        <SkeletonCard height={140} />
        <SkeletonCard height={140} />
      </div>

      <SkeletonCard height={180} />
    </div>
  );
}
