"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, padding: 48, textAlign: "center" }}>
      <i className="ph ph-warning-circle" style={{ fontSize: 28, color: "var(--priority-critical)" }} />
      <h4 style={{ margin: 0 }}>Something went wrong</h4>
      <p className="text-muted" style={{ fontSize: 13, maxWidth: 420 }}>
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      <button className="btn btn-secondary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
