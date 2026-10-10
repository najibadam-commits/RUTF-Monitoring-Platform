import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { latestLedgerMonth, monthOf } from "@/lib/queries/kpis";
import { RUTF_EXPORTS, type RutfExportKind } from "@/lib/exports/rutfExports";
import { monthChoices } from "@/components/reports/ReportShell";
import { RutfExportPanel } from "@/components/reports/RutfExportPanel";

export const metadata: Metadata = { title: "Programme Reporting" };

// Programme Reporting (DECISIONS R92): the Monthly Programme Report (one page, printable), the
// month's stock and KPI exports, and the Findings and supervision exports. Every export is scoped
// to what the reader may see; a Viewer's downloads go through Data Access Requests.

const REPORT_CONTENTS = [
  "Summary in plain sentences",
  "Stock position and months of stock",
  "Last-mile dispensing and children reached",
  "Reporting completeness and supervision",
  "Findings and the accountability score",
  "DHIS2 agreement",
  "LGAs needing support",
  "Actions for next month",
];

export default async function ReportingPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const latest = await latestLedgerMonth(supabase);
  const isViewer = profile.role === "viewer";
  const canPlan = ["super_admin", "project_admin", "tpm_supervisor"].includes(profile.role);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Programme Reporting</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
          Monthly evidence for the State, LGAs and partners, built straight from the ledger, visits and Findings: no
          spreadsheets to compile. Every report and export is scoped to what you may see; Viewers&apos; downloads need approval.
        </p>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, background: "var(--color-accent-100)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--color-accent-600)", color: "#fff", flex: "none" }}>
              <i className="ph-fill ph-file-text" style={{ fontSize: 22 }} aria-hidden="true" />
            </div>
            <div>
              <div className="card-title" style={{ fontSize: 17 }}>Monthly Programme Report</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>One page, ready to share · {monthOf(latest).label}</div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            The month&apos;s RUTF programme on a single page for the State Nutrition Officer, LGA teams and UNICEF, written from live
            data the moment you open it. Print it or save it as PDF.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href={`/reporting/monthly?month=${latest}`}>
              <i className="ph ph-file-text" aria-hidden="true" /> Open the {monthOf(latest).label} report
            </Link>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-700)", marginBottom: 8 }}>What it covers</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 16px", fontSize: 13 }}>
            {REPORT_CONTENTS.map((c) => <li key={c}>{c}</li>)}
          </ol>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {monthChoices(latest, 6).slice(1).map((m) => (
              <Link key={m.key} href={`/reporting/monthly?month=${m.key}`} className="tag tag-outline" style={{ textDecoration: "none" }}>{m.label}</Link>
            ))}
          </div>
        </div>
      </div>

      <RutfExportPanel
        exports={(Object.keys(RUTF_EXPORTS) as RutfExportKind[]).map((kind) => ({ kind, title: RUTF_EXPORTS[kind].title, description: RUTF_EXPORTS[kind].description }))}
        months={monthChoices(latest)}
        defaultMonth={latest}
        isViewer={isViewer}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        <div className="card elev-sm" style={{ gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="card-title" style={{ fontSize: 15 }}><i className="ph ph-list-bullets" aria-hidden="true" /> Findings Register</div>
            <p className="card-body" style={{ margin: 0 }}>
              Every Finding with its type, source, facility, ward, priority, status, owner and dates. Filter the register first and the
              export matches what is on screen.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isViewer ? (
              <Link className="btn btn-secondary" href="/issues"><i className="ph ph-paper-plane-tilt" /> Request from the register</Link>
            ) : (
              <>
                {/* Downloads (route handlers), not pages, so plain links. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a className="btn btn-secondary" href="/issues/export"><i className="ph ph-download-simple" /> CSV</a>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a className="btn btn-secondary" href="/issues/export?format=json"><i className="ph ph-download-simple" /> JSON</a>
              </>
            )}
          </div>
        </div>

        {canPlan && (
          <div className="card elev-sm" style={{ gap: 10, justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="card-title" style={{ fontSize: 15 }}><i className="ph ph-clipboard-text" aria-hidden="true" /> Supervision task lists</div>
              <p className="card-body" style={{ margin: 0 }}>
                The suggested visits for each supervisor this month, ranked by facility risk, for their task lists.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-secondary" href={`/supervision/plan.csv?month=${latest}`}><i className="ph ph-download-simple" /> CSV</a>
              <Link className="btn btn-ghost" href="/supervision?tab=planner">Open the planner</Link>
            </div>
          </div>
        )}

        <div className="card elev-sm" style={{ gap: 8 }}>
          <div className="card-title" style={{ fontSize: 15 }}><i className="ph ph-shield-check" aria-hidden="true" /> How exports protect data</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            <li>Scoped to your role and area, exactly as on screen</li>
            <li>No child or caregiver details can be exported: reports and exports are totals only</li>
            <li>Child counts under 5 shown as &quot;&lt;5&quot;</li>
            <li>Viewers&apos; downloads approved first, then downloaded once</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
