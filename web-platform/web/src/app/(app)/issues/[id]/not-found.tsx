import Link from "next/link";

export default function IssueNotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, padding: 48, textAlign: "center" }}>
      <i className="ph ph-file-x" style={{ fontSize: 28, color: "var(--color-neutral-500)" }} />
      <h4 style={{ margin: 0 }}>Finding not found</h4>
      <p className="text-muted" style={{ fontSize: 13 }}>
        It may have been deleted, or you may not have access to it.
      </p>
      <Link className="btn btn-secondary" href="/issues">
        Back to the Findings Register
      </Link>
    </div>
  );
}
