"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updatePassword } from "@/lib/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

export default function UpdatePasswordPage() {
  const [state, formAction, pending] = useActionState(updatePassword, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 style={{ marginBottom: 0 }}>Set a password</h3>
        <p className="text-muted" style={{ fontSize: 13.5, marginTop: -8 }}>
          Choose a password to finish setting up access to your account.
        </p>
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <div style={{ position: "relative" }}>
              <input
                className="input" id="password" name="password" type={showPassword ? "text" : "password"}
                required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                style={{ paddingRight: 44 }}
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
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <div style={{ position: "relative" }}>
              <input
                className="input" id="confirm" name="confirm" type={showConfirm ? "text" : "password"}
                required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)",
                  display: "inline-flex", background: "none", border: "none", cursor: "pointer",
                  color: "var(--color-neutral-600)", padding: 4, lineHeight: 0,
                }}
              >
                <i className={showConfirm ? "ph ph-eye-slash" : "ph ph-eye"} style={{ fontSize: 19 }} />
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 12.5, marginTop: -8 }}>
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
          {state?.error && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--priority-critical)" }}>
              {state.error}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
            {pending ? "Setting password…" : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
