"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Some Supabase auth email flows (invite/recovery) redirect with the
 * session tokens in the URL *fragment* (`#access_token=...&type=recovery`)
 * instead of the `token_hash` query param /auth/confirm expects — fragments
 * never reach the server, so a server Route Handler can't see them at all.
 * Browsers also preserve the original fragment across a server redirect
 * when the redirect's Location header doesn't specify a new one, which is
 * why it can end up here on /login even though /auth/confirm issued the
 * redirect. This picks that case up client-side: if there's a session in
 * the fragment, establish it (syncs to cookies via the browser client) and
 * continue on to the right place instead of leaving the user stuck on a
 * dead-end error.
 */
export function FragmentAuthHandler() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token")) {
      setChecked(true);
      return;
    }

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");

    if (!access_token || !refresh_token) {
      setChecked(true);
      return;
    }

    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      // Clear the sensitive fragment from the address bar regardless of outcome.
      window.history.replaceState(null, "", window.location.pathname);
      if (error) {
        setChecked(true);
        return;
      }
      router.replace(type === "invite" || type === "recovery" ? "/auth/update-password" : "/dashboard");
    });
  }, [router]);

  if (!checked) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <i className="ph ph-circle-notch spin" style={{ fontSize: 24, color: "var(--color-accent)" }} />
      </div>
    );
  }

  return null;
}
