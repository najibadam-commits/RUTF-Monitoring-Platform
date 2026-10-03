import Link from "next/link";
import { tagBg } from "@/lib/constants";

// Pieces shared by the Master Data tabs (same look as the original Settlements/Activity Sites screen).

const STATUS_META: Record<string, { label: string; color: string }> = {
  approved: { label: "Approved", color: "var(--status-resolved)" },
  pending_create: { label: "Pending — New", color: "var(--priority-high)" },
  pending_update: { label: "Pending — Edit", color: "var(--priority-high)" },
  pending_delete: { label: "Pending — Delete", color: "var(--priority-critical)" },
  rejected: { label: "Rejected", color: "var(--color-neutral-500)" },
};

export const STATUS_FILTER_OPTIONS = [
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending Review" },
  { value: "rejected", label: "Rejected" },
];

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "var(--color-neutral-500)" };
  return (
    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>
      {meta.label}
    </span>
  );
}

export function Pager({
  total,
  page,
  totalPages,
  hrefWith,
  noun,
  plural,
}: {
  total: number;
  page: number;
  totalPages: number;
  hrefWith: (patch: Record<string, string | null>) => string;
  noun: string;
  plural: [string, string];
}) {
  const disabled = { opacity: 0.45, pointerEvents: "none" as const };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
      <span className="text-muted" style={{ fontSize: 12.5 }}>
        {total.toLocaleString()} matching {noun}
        {total === 1 ? plural[0] : plural[1]} — page {page} of {totalPages}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        {page <= 1 ? (
          <span className="btn btn-secondary" aria-disabled="true" style={disabled}>
            Previous
          </span>
        ) : (
          <Link className="btn btn-secondary" href={hrefWith({ page: String(page - 1) })}>
            Previous
          </Link>
        )}
        {page >= totalPages ? (
          <span className="btn btn-secondary" aria-disabled="true" style={disabled}>
            Next
          </span>
        ) : (
          <Link className="btn btn-secondary" href={hrefWith({ page: String(page + 1) })}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
