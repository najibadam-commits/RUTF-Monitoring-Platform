import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function ProjectAdminsLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Skeleton style={{ width: 220, height: 22, marginBottom: 6 }} />
          <Skeleton style={{ width: 200, height: 13 }} />
        </div>
        <Skeleton style={{ width: 150, height: 34 }} />
      </div>
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
