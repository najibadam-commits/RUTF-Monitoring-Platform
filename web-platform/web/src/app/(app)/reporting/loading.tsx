import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function ReportingLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Skeleton style={{ width: 260, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 320, height: 13 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} height={90} />
        ))}
      </div>
    </div>
  );
}
