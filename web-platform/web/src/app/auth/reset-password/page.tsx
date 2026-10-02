"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/actions/auth";

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, undefined);
  const submitted = state !== undefined && !state.error;

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 style={{ marginBottom: 0 }}>Reset your password</h3>
        {submitted ? (
          <p className="text-muted" style={{ fontSize: 13.5 }}>
            If an account exists for that email, we&apos;ve sent a password reset link. Check your inbox.
          </p>
        ) : (
          <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input className="input" id="email" name="email" type="email" required autoComplete="username" />
            </div>
            {state?.error && (
              <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
                {state.error}
              </div>
            )}
            <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send Reset Link"}
            </button>
          </form>
        )}
        <div className="hr" />
        <div style={{ fontSize: 12.5, textAlign: "center" }}>
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
