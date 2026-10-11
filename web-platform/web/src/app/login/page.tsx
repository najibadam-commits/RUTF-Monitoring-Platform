import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalProfile } from "@/lib/supabase/dal";
import { LoginForm } from "./LoginForm";
import { FragmentAuthHandler } from "./FragmentAuthHandler";
import { RutfLogo, RutfMark } from "@/components/RutfMark";
import { BRAND, QUOTE, TAGLINE, WHY } from "@/lib/rutf-copy";
import s from "./login.module.css";

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

  return (
    <div className={s.page}>
      <FragmentAuthHandler />
      {/* Full-screen documentary photo, softened — fixed, so it stays put behind everything. */}
      <div className={s.backdrop} role="img" aria-label="Children holding RUTF sachets handed out by a community health worker" />

      <header className={s.header}>
        <Link href="/" className={s.brand} aria-label={`${BRAND.name}: home`}>
          <RutfLogo height={46} />
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
            <RutfMark size={56} />
            <div>
              <div className={s.cardKicker}>Secure sign-in</div>
              <h2 className={s.cardTitle}>Welcome back</h2>
              <p className={s.cardSub}>For authorised programme staff only.</p>
            </div>
          </div>

          <LoginForm next={next} linkError={linkError} linkMessage={linkMessage} />

          <div className={s.assurances}>
            <span><i className="ph-fill ph-shield-check" aria-hidden="true" /> Role-based access</span>
            <span><i className="ph-fill ph-clock-counter-clockwise" aria-hidden="true" /> Full audit trail</span>
            <span><i className="ph-fill ph-lock-key" aria-hidden="true" /> Child records: OTP Officer only</span>
            <span><i className="ph-fill ph-scales" aria-hidden="true" /> Designed for NDPA 2023</span>
          </div>
          <p className={s.help}>Need access? Ask your programme administrator.</p>
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
        <p className={s.quote}>{QUOTE}</p>
      </footer>
    </div>
  );
}
