import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Skeleton style={{ width: 180, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 240, height: 13 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} style={{ width: 110, height: 30 }} />
        ))}
      </div>
      <SkeletonCard height={280} />
    </div>
  );
}
