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
  { icon: "ph-warehouse", tone: "blue", title: "Receive at the State store", body: "Each consignment is logged by lot, with its expiry date, waybill and quantity, on the State ledger." },
  { icon: "ph-truck", tone: "green", title: "Transfer to the LGA store", body: "Every transfer has a traceable ID and is confirmed on receipt; short deliveries are recorded and reconciled." },
  { icon: "ph-first-aid-kit", tone: "purple", title: "Dispense at the OTP", body: "Facility staff record stock received, dispensed and expired, with daily OTP totals, even offline." },
  { icon: "ph-clipboard-text", tone: "orange", title: "Verify on supervision", body: "LGA and State nutrition officers count stock and check registers, visiting the highest-risk facilities first." },
  { icon: "ph-flag", tone: "teal", title: "Detect, correct, report", body: "Discrepancies become Findings, followed through to verified closure and triangulated with DHIS2." },
] as const;

// Named after the platform's own modules (lib/rbac.ts NAV_ITEMS), so the proposal and the demo match.
const FEATURES = [
  { icon: "ph-book-open-text", title: "Stock Ledger & Transfers", body: "A running balance per facility and lot. State → LGA → OTP movements are reconciled on receipt, short deliveries included." },
  { icon: "ph-device-mobile", title: "Offline Android app", body: "Facility staff and supervisors record without a signal. Offline Sync Health shows every device's last sync." },
  { icon: "ph-flag", title: "Automatic Findings", body: "Variances above threshold raise a Finding on their own, with a traceable ID such as KT-DAU-MAJ-OTP-26001." },
  { icon: "ph-kanban", title: "Corrective Action Tracker", body: "Every Finding is assigned, addressed and independently verified, with a target date for closure." },
  { icon: "ph-seal-check", title: "Accountability Scorecard", body: "Follow-through by LGA and facility: closed on time, overdue and reopened, so performance is visible." },
  { icon: "ph-map-trifold", title: "Command Centre & Situation Map", body: "Stock on hand, stock-outs, expiries and open Findings across every LGA, ward and facility in Katsina." },
  { icon: "ph-intersect", title: "DHIS2 Triangulation", body: "Each facility's DHIS2 monthly report is checked against the ledger, and the largest gaps are flagged first." },
  { icon: "ph-lock-key", title: "Privacy by design", body: "Aggregate OTP tallies only: no child or caregiver names, IDs or per-child records. Every change is audited." },
] as const;

const HERO_POINTS = [
  { icon: "ph-wifi-slash", label: "Works offline" },
  { icon: "ph-flag", label: "Automatic discrepancy checks" },
  { icon: "ph-intersect", label: "DHIS2 triangulation" },
] as const;

const GOVERNANCE = [
  "Data is recorded only by authorised government facility, store and programme staff",
  "Role-based access: each user works at their own facility and supply-chain level",
  "A supervisor reviews every Finding before anyone is asked to act, and can return it for correction",
  "Transactions are never deleted, only voided with a reason, and every change is in the Audit Trail",
  "Data exports need approval; small counts are suppressed in public views",
  "Designed for the Nigeria Data Protection Act 2023: aggregate OTP data only, with a data protection impact assessment",
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
              Every sachet of <span className={s.accent}>RUTF</span> tracked, verified and accounted for
            </h1>
            <p className={s.lead}>
              From the State store to the LGA store to the outpatient therapeutic programme (OTP), discrepancies are
              flagged automatically and followed to verified closure, so malnourished children get the right
              nutrition, at the right time, in the right place.
            </p>
            <ul className={s.heroPoints}>
              {HERO_POINTS.map((p) => (
                <li key={p.label}><i className={`ph-fill ${p.icon}`} aria-hidden="true" /> {p.label}</li>
              ))}
            </ul>
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
            <h2 className={s.h2}>One chain of custody, from State store to child</h2>
            <p className={s.sub}>
              The platform follows every lot of RUTF through the government supply chain, with a record at each
              hand-over and an independent check at every level.
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
              <h2 className={s.whyTitle}>Every sachet counts.<br />Every child counts.</h2>
              <p className={s.whyLead}>
                RUTF is a life-saving treatment for children with severe acute malnutrition (SAM), and every carton
                lost, expired or diverted is treatment a child does not receive. The platform gives the State, LGAs,
                facilities and partners one verified record of where RUTF is, so problems are caught early and put
                right, and donors can see that supplies reach the children they were meant for.
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
            <h2 className={s.h2}>From the store shelf to the child, every sachet accounted for</h2>
            <p className={s.sub}>
              One platform for facilities, stores, supervisors and programme managers: record, detect, correct and
              report on a single trusted record.
            </p>
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
            <h2 className={s.h2}>Trusted data, fair process, a complete audit trail</h2>
            <p className={s.govLead}>
              Findings are for review, not accusation. Every safeguard below is built into the platform, not left to
              policy alone.
            </p>
            <ul className={s.govList}>
              {GOVERNANCE.map((g) => (
                <li key={g}><i className="ph-fill ph-check-circle" aria-hidden="true" /> {g}</li>
              ))}
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
