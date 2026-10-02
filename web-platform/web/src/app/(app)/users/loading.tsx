import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function UsersLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Skeleton style={{ width: 220, height: 22, marginBottom: 6 }} />
          <Skeleton style={{ width: 160, height: 13 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton style={{ width: 110, height: 34 }} />
          <Skeleton style={{ width: 100, height: 34 }} />
        </div>
      </div>
      <SkeletonTable rows={8} columns={7} />
    </div>
  );
}
