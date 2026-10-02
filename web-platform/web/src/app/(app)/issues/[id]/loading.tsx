import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

// Overrides the parent `issues/loading.tsx` boundary specifically for the detail route — the
// detail page's own shape (header + stepper + info cards) doesn't match the list's table, so it
// gets its own skeleton rather than inheriting the list's.
export default function IssueDetailLoading() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Skeleton style={{ width: 160, height: 22, marginBottom: 6 }} />
        <Skeleton style={{ width: 220, height: 13 }} />
      </div>
      <SkeletonCard height={70} />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        <SkeletonCard height={220} />
        <SkeletonCard height={220} />
      </div>
      <SkeletonCard height={160} />
    </div>
  );
}
