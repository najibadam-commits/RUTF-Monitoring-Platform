import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalProfile } from "@/lib/supabase/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoginForm } from "./LoginForm";
import { FragmentAuthHandler } from "./FragmentAuthHandler";
import { RutfMark } from "@/components/RutfMark";
import { BRAND, QUOTE, TAGLINE, WHY } from "@/lib/rutf-copy";
import s from "./login.module.css";

/**
 * Live coverage counts for the stat row under the photo. Uses the service-role client because this
 * renders before sign-in and lgas/wards/activity_sites RLS only grants SELECT to `authenticated` —
 * safe because only aggregate counts leave this function, never row data (see createAdminClient).
 * Health facilities count `status = 'approved'` activity sites, i.e. what is live on the platform.
 * A count of zero is dropped (facilities aren't imported until M1), so the row never shows "0".
 */
async function getPlatformStats() {
  const admin = createAdminClient();
  const [lgas, wards, facilities] = await Promise.all([
    admin.from("lgas").select("*", { count: "exact", head: true }),
    admin.from("wards").select("*", { count: "exact", head: true }),
    admin.from("activity_sites").select("*", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  const rows = [
    { label: "LGAs", value: lgas.count ?? 0 },
    { label: "Wards", value: wards.count ?? 0 },
    { label: "Health facilities", value: facilities.count ?? 0 },
  ].filter((r) => r.value > 0);
  return rows.length ? rows : null;
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
    <div className={s.page}>
      <FragmentAuthHandler />
      {/* Full-screen documentary photo, softened — fixed, so it stays put behind everything. */}
      <div className={s.backdrop} role="img" aria-label="Children holding RUTF sachets handed out by a community health worker" />

      <header className={s.header}>
        <Link href="/" className={s.brand}>
          <RutfMark />
          <span>
            <span className={s.brandName}>{BRAND.name}</span>
            <span className={s.brandSub}>{BRAND.line1}<br />{BRAND.line2}</span>
          </span>
        </Link>
        <Link href="/" className={s.back}>
          <i className="ph ph-arrow-left" aria-hidden="true" /> Back to home
        </Link>
      </header>

      {/* The card sits where the photo's centre is, between the children on either side. */}
      <main className={s.main}>
        <h1 className={s.srOnly}>{TAGLINE}</h1>
        {/* Floating sign-in card — the form and its behaviour are unchanged. */}
        <section className={s.card}>
          <div className={s.cardHead}>
            <RutfMark size={52} />
            <div>
              <div className={s.cardKicker}>Sign in to your account</div>
              <p className={s.cardSub}>Use the email and password your administrator set up for you.</p>
            </div>
          </div>

          <LoginForm next={next} linkError={linkError} linkMessage={linkMessage} />

          <div className={s.assurances}>
            <span><i className="ph-fill ph-shield-check" aria-hidden="true" /> Role-based access</span>
            <span><i className="ph-fill ph-clock-counter-clockwise" aria-hidden="true" /> Audit trail</span>
            <span><i className="ph-fill ph-lock-key" aria-hidden="true" /> No child-level data</span>
          </div>
        </section>
      </main>

      {/* KPI statements floating over the photo — one row on desktop. */}
      <footer className={s.kpis}>
        <ul className={s.kpiRow}>
          {WHY.map((w) => (
            <li key={w.title} className={s.kpi}>
              <i className={`ph ${w.icon} ${s.kpiIcon}`} aria-hidden="true" />
              <span>
                <span className={s.kpiTitle}>{w.title}</span>
                <span className={s.kpiBody}>{w.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={s.quote}>
          {QUOTE}
          {stats && (
            <span className={s.stats}>
              {stats.map((stat) => (
                <span key={stat.label}>
                  <strong>{stat.value.toLocaleString()}</strong> {stat.label}
                </span>
              ))}
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}
