"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login } from "@/lib/actions/auth";

export function LoginForm({ next, linkError, linkMessage }: { next?: string; linkError?: string; linkMessage?: string }) {
  const [state, formAction, pending] = useActionState(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="login-form-lg" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      {linkError && (
        <div role="alert" style={{ fontSize: 14, color: "var(--priority-critical)" }}>
          {linkError}
        </div>
      )}
      {linkMessage && !linkError && (
        <div role="status" style={{ fontSize: 14, color: "var(--status-resolved)" }}>
          {linkMessage}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <div style={{ position: "relative" }}>
          <i
            className="ph ph-envelope-simple"
            style={{
              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
              fontSize: 18, color: "var(--color-neutral-600)", pointerEvents: "none",
            }}
          />
          <input
            className="input" id="email" name="email" type="email" required autoComplete="username"
            placeholder="Enter your email address"
            style={{ paddingLeft: 42 }}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div style={{ position: "relative" }}>
          <i
            className="ph ph-lock-simple"
            style={{
              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
              fontSize: 18, color: "var(--color-neutral-600)", pointerEvents: "none",
            }}
          />
          <input
            className="input" id="password" name="password" type={showPassword ? "text" : "password"}
            required autoComplete="current-password" placeholder="Enter your password"
            style={{ paddingLeft: 42, paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            style={{
              position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)",
              display: "inline-flex", background: "none", border: "none", cursor: "pointer",
              color: "var(--color-neutral-600)", padding: 4, lineHeight: 0,
            }}
          >
            <i className={showPassword ? "ph ph-eye-slash" : "ph ph-eye"} style={{ fontSize: 19 }} />
          </button>
        </div>
      </div>
      {state?.error && (
        <div role="alert" style={{ fontSize: 14, color: "var(--priority-critical)" }}>
          {state.error}
        </div>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? (
          "Signing in…"
        ) : (
          <>
            <i className="ph ph-sign-in" style={{ fontSize: 18 }} />
            Sign in
          </>
        )}
      </button>
      <div style={{ fontSize: 14, textAlign: "center" }}>
        <Link href="/auth/reset-password">Forgot your password?</Link>
      </div>
    </form>
  );
}
