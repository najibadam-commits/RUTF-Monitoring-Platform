import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function DataSetsLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Skeleton style={{ width: 180, height: 22, marginBottom: 6 }} />
          <Skeleton style={{ width: 220, height: 13 }} />
        </div>
        <Skeleton style={{ width: 130, height: 34 }} />
      </div>
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
