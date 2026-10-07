"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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
const fragmentParams = () => new URLSearchParams(window.location.hash.slice(1));
const hasFragmentSession = () => {
  const params = fragmentParams();
  return Boolean(params.get("access_token") && params.get("refresh_token"));
};
// The address bar is read once per render; nothing to subscribe to.
const noSubscription = () => () => {};

export function FragmentAuthHandler() {
  const router = useRouter();
  // On the server there is no fragment to read, so assume one until the browser has checked —
  // the spinner is the first paint either way and never flashes the login form under it.
  const pending = useSyncExternalStore(noSubscription, hasFragmentSession, () => true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const params = fragmentParams();
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");
    if (!access_token || !refresh_token) return;

    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      // Clear the sensitive fragment from the address bar regardless of outcome.
      window.history.replaceState(null, "", window.location.pathname);
      if (error) {
        setFailed(true);
        return;
      }
      router.replace(type === "invite" || type === "recovery" ? "/auth/update-password" : "/dashboard");
    });
  }, [pending, router]);

  if (pending && !failed) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <i className="ph ph-circle-notch spin" style={{ fontSize: 24, color: "var(--color-accent)" }} />
      </div>
    );
  }

  return null;
}
