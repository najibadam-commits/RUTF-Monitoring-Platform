import Link from "next/link";
import { getOptionalProfile } from "@/lib/supabase/dal";
import { RutfMark } from "@/components/RutfMark";
import { BRAND, QUOTE, TAGLINE, WHY } from "@/lib/rutf-copy";
import s from "./landing.module.css";

/**
 * Public landing page. Copy follows RUTF_BUILD_BRIEF.md §1 (facility recording + supervisor
 * checks, State store → LGA store → OTP): no QR codes, beneficiary IDs or per-child tracking,
 * which the brief puts out of scope. Photos are cropped from "Landing page pictures/" with the
 * baked-in login mock-ups and caption bands cut away.
 */

const STEPS = [
  { icon: "ph-warehouse", tone: "blue", title: "State store", body: "Each batch is received as a lot, with its expiry date, waybill and quantity on the State ledger." },
  { icon: "ph-truck", tone: "green", title: "LGA store", body: "Shipments are tracked with digital records from warehouse to facility, and short deliveries are reconciled." },
  { icon: "ph-first-aid-kit", tone: "purple", title: "Health facility", body: "Stock levels are monitored, including arrival, usage and expiry dates, with daily OTP dispensing totals." },
  { icon: "ph-clipboard-text", tone: "orange", title: "Supervision", body: "LGA and State nutrition officers verify stock and registers on routine supervision visits." },
  { icon: "ph-flag", tone: "teal", title: "Findings & reporting", body: "Discrepancies above threshold become Findings, followed through to corrective action and closure." },
] as const;

const FEATURES = [
  { icon: "ph-book-open-text", title: "Stock ledger", body: "Running balance per facility and lot, with documents and photos of stock cards." },
  { icon: "ph-arrows-left-right", title: "Transfers", body: "State → LGA → OTP movements in transit, received, or with a discrepancy." },
  { icon: "ph-device-mobile", title: "Offline Android app", body: "Record at the facility without a signal; entries sync once connectivity returns." },
  { icon: "ph-map-trifold", title: "GIS map", body: "Facilities, stock-outs, transfers and open Findings across Katsina's LGAs and wards." },
  { icon: "ph-chart-line-up", title: "Dashboards", body: "Stock on hand, variance, short-dispensing, reporting completeness and expiries." },
  { icon: "ph-lock-key", title: "Privacy by design", body: "Aggregate OTP tallies only — no child or caregiver names, IDs or per-child records." },
] as const;

export default async function LandingPage() {
  const profile = await getOptionalProfile();
  const cta = profile
    ? { href: "/dashboard", label: "Open dashboard", icon: "ph-squares-four" }
    : { href: "/login", label: "Login", icon: "ph-user" };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.brand}>
            <RutfMark />
            <span>
              <span className={s.brandName}>{BRAND.name}</span>
              <span className={s.brandSub}>{BRAND.line1}<br />{BRAND.line2}</span>
            </span>
          </Link>
          <nav className={s.nav} aria-label="Sections">
            <a href="#how-it-works">How it works</a>
            <a href="#why">Why it matters</a>
            <a href="#features">Features</a>
            <a href="#governance">Governance</a>
          </nav>
          <Link href={cta.href} className={s.btnPrimary}>
            <i className={`ph ${cta.icon}`} aria-hidden="true" /> {cta.label}
          </Link>
        </div>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.heroPhoto} role="img" aria-label="A health worker hands an RUTF sachet to a child at a facility, with RUTF cartons on the table behind" />
          <div className={s.heroText}>
            <div className={s.kicker}>{TAGLINE}</div>
            <h1 className={s.heroTitle}>
              Ready-to-Use Therapeutic Food <span className={s.accent}>(RUTF)</span> Monitoring &amp; Accountability Platform
            </h1>
            <p className={s.lead}>
              Every packet of RUTF is tracked, verified and accounted for — from the State store to the LGA store to
              the outpatient therapeutic programme (OTP) — so that malnourished children get the right nutrition, at
              the right time, in the right place.
            </p>
            <div className={s.heroActions}>
              <Link href={cta.href} className={s.btnPrimary}>
                {profile ? "Open dashboard" : "Sign in to the platform"} <i className="ph ph-arrow-right" aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className={s.btnOutline}>
                <i className="ph-fill ph-play-circle" aria-hidden="true" /> See how it works
              </a>
            </div>
            <div className={s.pilot}>
              <i className="ph-fill ph-map-pin" aria-hidden="true" /> Pilot: all LGAs, wards and health facilities in Katsina State
            </div>
          </div>
        </section>

        <section id="how-it-works" className={s.section}>
          <div className={s.sectionHead}>
            <div className={s.kicker}>How it works</div>
            <h2 className={s.h2}>End-to-end visibility. Greater impact.</h2>
            <p className={s.sub}>
              The platform follows RUTF through the government supply chain, with facility recording and supervisor
              checks at every level.
            </p>
          </div>
          <ol className={s.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={s.step}>
                <span className={`${s.stepNum} ${s[step.tone]}`}>{i + 1}</span>
                <i className={`ph-duotone ${step.icon} ${s.stepIcon} ${s[`${step.tone}Text`]}`} aria-hidden="true" />
                <h3 className={s.stepTitle}>{step.title}</h3>
                <p className={s.stepBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="why" className={s.why}>
          <div className={s.whyPhoto} role="img" aria-label="Children eating from RUTF sachets" />
          <div className={s.whyInner}>
            <div className={s.whyText}>
              <div className={`${s.kicker} ${s.kickerLight}`}>Why it matters</div>
              <h2 className={s.whyTitle}>Transparency today.<br />Healthier tomorrows.</h2>
              <p className={s.whyLead}>
                By digitising the RUTF supply chain inside the health-facility structure, the platform reduces loss
                and diversion, builds trust and helps save the lives of children suffering from severe acute
                malnutrition.
              </p>
              <a href="#features" className={s.btnLight}>
                Learn more <i className="ph ph-arrow-right" aria-hidden="true" />
              </a>
            </div>
            <ul className={s.whyGrid}>
              {WHY.map((w) => (
                <li key={w.title} className={s.whyItem}>
                  <span className={`${s.whyIcon} ${s[w.tone]}`}><i className={`ph-fill ${w.icon}`} aria-hidden="true" /></span>
                  <h3 className={s.whyItemTitle}>{w.title}</h3>
                  <p className={s.whyItemBody}>{w.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className={s.quote}>{QUOTE}</p>
        </section>

        <section id="features" className={s.section}>
          <div className={s.sectionHead}>
            <div className={s.kicker}>Features</div>
            <h2 className={s.h2}>Built for facilities, stores and supervisors</h2>
          </div>
          <div className={s.featureWrap}>
            <div className={s.featurePhoto} role="img" aria-label="A health worker smiles with a child holding RUTF sachets" />
            <ul className={s.features}>
              {FEATURES.map((f) => (
                <li key={f.title} className={s.feature}>
                  <i className={`ph-duotone ${f.icon} ${s.featureIcon}`} aria-hidden="true" />
                  <div>
                    <h3 className={s.featureTitle}>{f.title}</h3>
                    <p className={s.featureBody}>{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="governance" className={s.governance}>
          <div className={s.govBadge} aria-hidden="true"><i className="ph-duotone ph-shield-check" /></div>
          <div className={s.govText}>
            <div className={s.kicker}>Governance</div>
            <h2 className={s.h2}>Findings are for review, not accusation</h2>
            <ul className={s.govList}>
              <li><i className="ph-fill ph-check-circle" aria-hidden="true" /> Data recorded by authorised government facility and programme staff</li>
              <li><i className="ph-fill ph-check-circle" aria-hidden="true" /> Role-based access per facility and supply-chain level</li>
              <li><i className="ph-fill ph-check-circle" aria-hidden="true" /> Transactions are never deleted — only voided with a reason, in the audit trail</li>
              <li><i className="ph-fill ph-check-circle" aria-hidden="true" /> Exports go through an approval step; small counts are suppressed in public views</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.footerInner}>
          <span className={s.footerBrand}><RutfMark size={28} /> {BRAND.name} · Katsina State</span>
          <Link href={cta.href} className={s.footerLink}>{cta.label}</Link>
        </div>
      </footer>
    </div>
  );
}
