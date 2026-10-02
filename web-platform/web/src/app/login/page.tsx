import { redirect } from "next/navigation";
import { getOptionalProfile } from "@/lib/supabase/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoginForm } from "./LoginForm";
import { FragmentAuthHandler } from "./FragmentAuthHandler";

/**
 * Live platform-coverage counts for the hero's stat row — replaces the stale "37 States /
 * 477 LGAs"-style numbers that used to be baked as pixels into login-hero.png itself (not DOM
 * text, so they couldn't be fixed by editing a string anywhere — see the stat row's placement
 * below). Settlements/Activity Sites count only `status = 'approved'` rows, matching what's
 * actually "available" on the platform (a pending/rejected submission isn't live yet).
 *
 * Uses the service-role client because this renders on the public, pre-login page — states/lgas/
 * settlements/activity_sites RLS policies only grant SELECT to the `authenticated` role, so an
 * anonymous visitor's own client would get zero rows for all four. Safe here specifically because
 * only plain aggregate counts leave this function, never row data — see createAdminClient's kdoc
 * for why this key otherwise stays behind a caller-role check.
 */
async function getPlatformStats() {
  const admin = createAdminClient();
  const [states, lgas, settlements, activitySites] = await Promise.all([
    admin.from("states").select("*", { count: "exact", head: true }),
    admin.from("lgas").select("*", { count: "exact", head: true }),
    admin.from("settlements").select("*", { count: "exact", head: true }).eq("status", "approved"),
    admin.from("activity_sites").select("*", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  return {
    states: states.count ?? 0,
    lgas: lgas.count ?? 0,
    settlements: settlements.count ?? 0,
    activitySites: activitySites.count ?? 0,
  };
}

/** Query-param error codes /auth/confirm and other auth routes redirect here with — never
 *  Supabase's own raw error text, and never silently dropped (see LoginForm's linkError prop). */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  "link-expired": "This invitation or password reset link has expired or is no longer valid. Please contact your administrator to request a new invitation.",
};

/** Query-param success codes another auth flow redirects here with — see LoginForm's
 *  linkMessage prop; currently just updatePassword's post-setup redirect. */
const LINK_SUCCESS_MESSAGES: Record<string, string> = {
  "password-set": "Password set successfully. Sign in with your new password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; message?: string }>;
}) {
  const profile = await getOptionalProfile();
  if (profile) redirect("/dashboard");

  const { next, error, message } = await searchParams;
  const linkError = error ? (LINK_ERROR_MESSAGES[error] ?? "That link is no longer valid. Please try again or contact your administrator.") : undefined;
  const linkMessage = message ? LINK_SUCCESS_MESSAGES[message] : undefined;
  // Never let a stats query failure take down the login page itself — but do log it, so a
  // silent failure (e.g. a missing env var in this deploy's environment scope) is at least
  // visible in the server's runtime logs instead of just quietly hiding the stat row forever.
  const stats = await getPlatformStats().catch((e) => {
    console.error("getPlatformStats failed:", e instanceof Error ? e.message : e);
    return null;
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
      <FragmentAuthHandler />

      {/* ── Left: hero ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "none",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          // WebP re-encode of the same 1717x916 hero photo — visually identical, ~93% smaller
          // (2.0MB -> 135KB) so the login page's first paint isn't held up by a multi-megabyte
          // background image.
          backgroundImage: "url(/login-hero.webp)",
          backgroundSize: "cover",
          backgroundPosition: "center 38%",
        }}
        className="login-hero"
      >
        {/* Scrim: darkens only the lower band (where the headline sits, over the officer/grass/
            wave-curve area) so the photo's own upper content — the 37/774/5-stage stat badges
            and the Nigeria map graphic — stays fully visible and unobscured. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(0deg, rgba(8, 18, 38, 0.86) 0%, rgba(8, 18, 38, 0.58) 26%, rgba(8, 18, 38, 0) 48%)",
          }}
        />

        {/* Logo lockup — top, over open sky, clear of the photo's baked-in stat badges */}
        <div style={{ padding: "56px 64px 0", position: "relative", zIndex: 1 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44, height: 44, borderRadius: 12, flex: "none",
                display: "grid", placeItems: "center",
                background: "#fff",
                boxShadow: "0 4px 12px rgba(18, 59, 115, 0.28)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed local brand asset */}
              <img src="/tpm-logo-mark.png" alt="TPM" style={{ width: 32, height: 32 }} />
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.35)" }}>
                RUTF Monitoring Platform
              </div>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", fontWeight: 600, color: "var(--color-accent-200)" }}>
                TRACK&nbsp;&nbsp;|&nbsp;&nbsp;VERIFY&nbsp;&nbsp;|&nbsp;&nbsp;IMPACT
              </div>
            </div>
          </div>
        </div>

        {/* Live stat row — the photo has its own stat badges baked into the image itself
            (visible higher up, near the logo), showing stale counts frozen at export time (see
            getPlatformStats' kdoc). Can't edit those pixels without a new photo asset from
            design, so this real, database-backed row sits lower in the empty band instead —
            clear of the old badges, not overlapping them — with its own scrim for legibility.
            The map graphic/pin markers elsewhere in the photo are unaffected. */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          {stats && (
            <div
              style={{
                margin: "0 64px 8px",
                padding: "18px 22px",
                borderRadius: 14,
                background: "rgba(8, 18, 38, 0.62)",
                backdropFilter: "blur(2px)",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              {[
                { label: "States", value: stats.states },
                { label: "LGAs", value: stats.lgas },
                { label: "Settlements", value: stats.settlements },
                { label: "Health Facilities", value: stats.activitySites },
              ].map((stat) => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 26, color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.35)" }}>
                    {stat.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11.5, letterSpacing: "0.06em", color: "rgba(255, 255, 255, 0.82)" }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Headline + subtext — bottom band, over the officer/grass/wave-curve area of the
            photo, clear of the stat badges and map graphic above. */}
        <div style={{ padding: "0 64px 64px", position: "relative", zIndex: 1 }}>
          <h1 style={{ maxWidth: 420, color: "#fff", textShadow: "0 2px 10px rgba(0,0,0,0.35)" }}>
            Third-Party Monitoring &amp; <span style={{ color: "var(--color-accent-200)" }}>Live GIS Oversight</span>
          </h1>
          <p style={{ maxWidth: 400, fontSize: 15, color: "rgba(255, 255, 255, 0.88)", textShadow: "0 1px 6px rgba(0,0,0,0.3)" }}>
            Track field-reported findings from discovery through DRI resolution and final verification, with a live
            geographic view of where and how monitoring activity is unfolding across Nigeria&apos;s states and LGAs.
          </p>
        </div>
      </div>

      {/* ── Right: sign-in card ────────────────────────────────────────── */}
      <div className="login-panel" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", position: "relative", minWidth: 0 }}>
        <div style={{ position: "absolute", top: 28, right: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-neutral-700)" }}>
          <i className="ph-fill ph-map-pin" style={{ color: "var(--color-accent-600)" }} />
          Better Data. Safer Communities.
        </div>

        <div className="card elev-lg login-form-lg" style={{ width: "100%", maxWidth: 440, padding: 44, gap: 0, border: "1px solid var(--color-divider)" }}>
          <div style={{ marginBottom: 28 }}>
            {/* Full logo (mark + wordmark + tagline), not the compact mark — this is the
                platform's main "who am I signing into" moment, with room to spare; the mark
                alone is reserved for space-constrained spots (sidebar, favicon, app icon). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed local brand asset */}
            <img src="/tpm-logo-full.png" alt="RUTF Monitoring Platform" style={{ height: 150, width: "auto" }} />
          </div>

          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "0.1em", color: "var(--color-accent-600)", marginBottom: 6 }}>
            SIGN IN TO YOUR ACCOUNT
          </div>
          <p className="text-muted" style={{ fontSize: 15.5, marginBottom: 28 }}>
            Use the email and password your administrator set up for you.
          </p>

          <LoginForm next={next} linkError={linkError} linkMessage={linkMessage} />

          <div className="hr" style={{ marginTop: 28, marginBottom: 20 }} />
          <div style={{ display: "flex", justifyContent: "center", gap: 20, fontSize: 13.5, color: "var(--color-neutral-600)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="ph-fill ph-shield-check" style={{ color: "var(--status-resolved)" }} /> Secure
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="ph-fill ph-check-circle" style={{ color: "var(--status-resolved)" }} /> Reliable
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="ph-fill ph-star" style={{ color: "var(--status-resolved)" }} /> Trusted
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .login-hero { display: flex !important; flex: 0 0 68% !important; max-width: 68%; }
          .login-panel { flex: 0 0 32% !important; max-width: 32%; }
        }
      `}</style>
    </div>
  );
}
