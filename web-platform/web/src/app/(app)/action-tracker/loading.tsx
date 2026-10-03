import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function ActionTrackerLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Skeleton style={{ width: 200, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 260, height: 13 }} />
      </div>
      <SkeletonTable rows={8} columns={7} />
    </div>
  );
}
