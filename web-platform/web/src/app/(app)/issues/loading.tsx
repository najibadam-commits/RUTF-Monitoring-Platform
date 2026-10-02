import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function IssuesLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Skeleton style={{ width: 180, height: 22, marginBottom: 6 }} />
          <Skeleton style={{ width: 140, height: 13 }} />
        </div>
        <Skeleton style={{ width: 120, height: 34 }} />
      </div>
      <div className="card elev-sm" style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} style={{ width: 140, height: 34 }} />
        ))}
      </div>
      <SkeletonTable rows={10} columns={8} />
    </div>
  );
}
