import { logout } from "@/lib/actions/auth";

export default function DeactivatedPage() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
      <div className="card elev-md" style={{ maxWidth: 380, textAlign: "center", padding: 24, gap: 12 }}>
        <i className="ph ph-lock" style={{ fontSize: 28, color: "var(--priority-critical)" }} />
        <h4 style={{ margin: 0 }}>Account deactivated</h4>
        <p className="card-body">Your account has been deactivated. Contact your Super Admin or Project Admin to restore access.</p>
        <form action={logout}>
          <button className="btn btn-secondary btn-block" type="submit">
            Back to sign in
          </button>
        </form>
      </div>
    </div>
  );
}
