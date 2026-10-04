import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/lib/constants";
import { Flag } from "@/components/reports/ReportShell";
import type { IssuePriority, IssueStatus } from "@/lib/types/database";

// Accountability Scorecard view (DECISIONS R57): every Finding from the moment it is raised to verified
// closure — how many, how far along, how fast, and where they are waiting. Replaces Findings
// Analytics and Time Efficiency Analysis. RLS scopes the Findings to the caller. Findings are for
// review, not accusation (brief §10): the tables show where follow-up is waiting, not blame.

const DAY = 86_400_000;
const OPEN: IssueStatus[] = ["new", "pending_review", "returned_for_correction", "assigned", "in_progress", "resolved", "reopened"];
const APPROVED: IssueStatus[] = ["assigned", "in_progress", "resolved", "verified_closed", "reopened"];
const RESPONDED: IssueStatus[] = ["in_progress", "resolved", "verified_closed", "reopened"];
const RESOLVED: IssueStatus[] = ["resolved", "verified_closed"];

export type ScorecardRow = {
  status: IssueStatus;
  priority: IssuePriority;
  reported_at: string;
  resolution_date: string | null;
  auto_generated: boolean;
  lga: { name: string } | null;
  category: { name: string } | null;
  dri: { id: string; name: string } | null;
};

export interface TimeEfficiencyStats {
  avg_report_to_assign_hours: number | null;
  avg_assign_to_response_hours: number | null;
  avg_response_to_corrective_hours: number | null;
  avg_corrective_to_verify_hours: number | null;
  by_priority: { priority: IssuePriority; resolved_count: number; avg_days: number | null }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? Math.round((n * 100) / d) : 0);
const fmtDays = (d: number | null) => (d === null ? "—" : `${d.toFixed(1)} d`);
const fmtHours = (h: number | null) => (h == null ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);

function summarise(rows: ScorecardRow[], targetDays: number, now: number) {
  const closed = rows.filter((r) => r.status === "verified_closed");
  const open = rows.filter((r) => OPEN.includes(r.status));
  const pastTarget = open.filter((r) => (now - Date.parse(r.reported_at)) / DAY > targetDays);
  const days = rows.filter((r) => RESOLVED.includes(r.status) && r.resolution_date)
    .map((r) => (Date.parse(r.resolution_date!) - Date.parse(r.reported_at)) / DAY);
  // Accountability score (DECISIONS R86), 0–100: half the share of Findings verified & closed, half
  // the share not left open past the target. Transparent on purpose — both halves are in the table.
  const score = rows.length ? Math.round(50 * (closed.length / rows.length) + 50 * (1 - pastTarget.length / rows.length)) : null;
  return { raised: rows.length, open: open.length, closed: closed.length, pastTarget: pastTarget.length, medianDays: median(days), score };
}

/** Score bands, with icon + label (never colour alone). "Needs support", not "failing": Findings
 *  are for review, not accusation. */
function grade(score: number | null) {
  if (score === null) return { label: "No Findings", color: "var(--color-neutral-600)", icon: "ph-minus-circle" };
  if (score >= 80) return { label: "On track", color: "var(--status-resolved)", icon: "ph-check-circle" };
  if (score >= 60) return { label: "Needs attention", color: "var(--priority-high)", icon: "ph-warning" };
  return { label: "Needs support", color: "var(--priority-critical)", icon: "ph-hand-heart" };
}

/** Fewer Findings than this and the score is shown but flagged as based on few Findings. */
const FEW = 5;

function LgaLeague({ groups, targetDays, now }: { groups: Map<string, ScorecardRow[]>; targetDays: number; now: number }) {
  const lines = [...groups.entries()]
    .map(([name, rs]) => ({ name, ...summarise(rs, targetDays, now) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.raised - a.raised || a.name.localeCompare(b.name));
  const counts = { on: 0, attn: 0, support: 0 };
  for (const l of lines) {
    if (l.score === null) continue;
    if (l.score >= 80) counts.on += 1;
    else if (l.score >= 60) counts.attn += 1;
    else counts.support += 1;
  }
  const row = (l: (typeof lines)[number], rank: number) => {
    const g = grade(l.score);
    return (
      <tr key={l.name}>
        <td className="text-muted" style={{ textAlign: "right" }}>{rank}</td>
        <td>
          {l.name}
          {l.raised < FEW && <span className="text-muted" style={{ fontSize: 11 }}> · few Findings</span>}
        </td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ width: 28, textAlign: "right", fontFamily: "var(--font-heading)" }}>{l.score ?? "—"}</strong>
            <div style={{ flex: 1, minWidth: 60 }}><Bar value={l.score ?? 0} max={100} color={g.color} /></div>
          </div>
        </td>
        <td style={{ color: g.color, fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>
          <i className={`ph-fill ${g.icon}`} aria-hidden="true" /> {g.label}
        </td>
        <td style={{ textAlign: "right" }}>{l.raised}</td>
        <td style={{ textAlign: "right" }}>{pct(l.closed, l.raised)}%</td>
        <td style={{ textAlign: "right" }}>{l.pastTarget ? <Flag level="warning">{l.pastTarget}</Flag> : 0}</td>
        <td style={{ textAlign: "right" }}>{fmtDays(l.medianDays)}</td>
      </tr>
    );
  };
  const head = (
    <colgroup>
      <col style={{ width: 44 }} /><col style={{ width: "20%" }} /><col style={{ width: "22%" }} /><col style={{ width: 150 }} /><col /><col /><col /><col />
    </colgroup>
  );
  return (
    <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 16px 0" }}>
        <div>
          <div className="card-title">LGA league table</div>
          <div className="text-muted" style={{ fontSize: 12, maxWidth: 620 }}>
            Score out of 100: half the share of Findings verified &amp; closed, half the share not left open past {targetDays} days.
            80 and above is on track; below 60, the LGA team needs support to close its Findings.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5 }}>
          {([["on track", counts.on, 90], [counts.attn === 1 ? "needs attention" : "need attention", counts.attn, 70], [counts.support === 1 ? "needs support" : "need support", counts.support, 0]] as const).map(([label, n, sample]) => {
            const g = grade(sample);
            return (
              <span key={label} style={{ color: g.color, fontWeight: 600, whiteSpace: "nowrap" }}>
                <i className={`ph-fill ${g.icon}`} aria-hidden="true" /> {n} {label}
              </span>
            );
          })}
        </div>
      </div>
      <table className="table" style={{ marginTop: 8, tableLayout: "fixed", minWidth: 760 }}>
        {head}
        <thead>
          <tr>
            <th style={{ textAlign: "right" }}>#</th>
            <th>LGA</th>
            <th>Score</th>
            <th>Rating</th>
            <th style={{ textAlign: "right" }}>Findings</th>
            <th style={{ textAlign: "right" }}>Closed</th>
            <th style={{ textAlign: "right" }}>Past target</th>
            <th style={{ textAlign: "right" }}>Median days</th>
          </tr>
        </thead>
        <tbody>
          {lines.slice(0, SHOWN).map((l, i) => row(l, i + 1))}
          {lines.length === 0 && (
            <tr><td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No Findings yet.</td></tr>
          )}
        </tbody>
      </table>
      {lines.length > SHOWN && (
        <details>
          <summary style={{ cursor: "pointer", padding: "10px 16px", fontSize: 13, color: "var(--color-accent)" }}>
            Show all {lines.length} LGAs
          </summary>
          <table className="table" style={{ tableLayout: "fixed", minWidth: 760 }}>
            {head}
            <tbody>{lines.slice(SHOWN).map((l, i) => row(l, i + SHOWN + 1))}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function groupBy(rows: ScorecardRow[], key: (r: ScorecardRow) => string) {
  const m = new Map<string, ScorecardRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

function Bar({ value, max, color = "var(--color-accent-500)" }: { value: number; max: number; color?: string }) {
  return (
    <div style={{ height: 8, borderRadius: 4, background: "var(--color-accent-100)" }}>
      <div style={{ height: "100%", width: `${max ? Math.max(value ? 2 : 0, (value / max) * 100) : 0}%`, borderRadius: 4, background: color }} />
    </div>
  );
}

const SHOWN = 10;

function ResponsibilityTable({ title, label, countLabel = "Raised", groups, targetDays, now }: { title: string; label: string; countLabel?: string; groups: Map<string, ScorecardRow[]>; targetDays: number; now: number }) {
  const lines = [...groups.entries()]
    .map(([name, rs]) => ({ name, ...summarise(rs, targetDays, now) }))
    .sort((a, b) => b.pastTarget - a.pastTarget || b.open - a.open || a.name.localeCompare(b.name));
  const head = (
    <colgroup>
      <col style={{ width: "28%" }} /><col /><col /><col /><col /><col /><col />
    </colgroup>
  );
  const body = (ls: typeof lines) =>
    ls.map((l) => (
      <tr key={l.name}>
        <td>{l.name}</td>
        <td style={{ textAlign: "right" }}>{l.raised}</td>
        <td style={{ textAlign: "right" }}>{l.open}</td>
        <td style={{ textAlign: "right" }}>{l.closed}</td>
        <td style={{ textAlign: "right" }}>{pct(l.closed, l.raised)}%</td>
        <td style={{ textAlign: "right" }}>{fmtDays(l.medianDays)}</td>
        <td style={{ textAlign: "right" }}>{l.pastTarget ? <Flag level="warning">{l.pastTarget}</Flag> : 0}</td>
      </tr>
    ));
  return (
    <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
      <div className="card-title" style={{ padding: "14px 16px 0" }}>{title}</div>
      {lines.length > SHOWN && (
        <div className="text-muted" style={{ fontSize: 12, padding: "2px 16px 0" }}>The {SHOWN} with the most Findings waiting.</div>
      )}
      <table className="table" style={{ marginTop: 6, tableLayout: "fixed" }}>
        {head}
        <thead>
          <tr>
            <th>{label}</th>
            <th style={{ textAlign: "right" }}>{countLabel}</th>
            <th style={{ textAlign: "right" }}>Open</th>
            <th style={{ textAlign: "right" }}>Closed</th>
            <th style={{ textAlign: "right" }}>Close rate</th>
            <th style={{ textAlign: "right" }}>Median days</th>
            <th style={{ textAlign: "right" }}>Past target</th>
          </tr>
        </thead>
        <tbody>
          {body(lines.slice(0, SHOWN))}
          {lines.length === 0 && (
            <tr><td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 16 }}>No Findings yet.</td></tr>
          )}
        </tbody>
      </table>
      {lines.length > SHOWN && (
        <details>
          <summary style={{ cursor: "pointer", padding: "10px 16px", fontSize: 13, color: "var(--color-accent)" }}>
            Show all {lines.length}
          </summary>
          <table className="table" style={{ tableLayout: "fixed" }}>
            {head}
            <tbody>{body(lines.slice(SHOWN))}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function AccountabilityScorecard({ rows, stats, targetDays, now }: { rows: ScorecardRow[]; stats: TimeEfficiencyStats | null; targetDays: number; now: number }) {
  const all = summarise(rows, targetDays, now);
  const auto = rows.filter((r) => r.auto_generated).length;
  const awaitingReview = rows.filter((r) => ["new", "pending_review", "returned_for_correction"].includes(r.status)).length;

  // Follow-through: how far the Findings have travelled.
  const funnel = [
    { label: "Raised", n: rows.length, help: auto ? `${pct(auto, rows.length)}% by automatic checks on the ledger and visits` : "" },
    { label: "Approved for action", n: rows.filter((r) => APPROVED.includes(r.status)).length, help: `${awaitingReview} waiting for review` },
    { label: "Responded to", n: rows.filter((r) => RESPONDED.includes(r.status)).length, help: "The responsible person has acted" },
    { label: "Resolved", n: rows.filter((r) => RESOLVED.includes(r.status)).length, help: "Corrective action recorded" },
    { label: "Verified & closed", n: all.closed, help: "Checked and closed by a supervisor" },
  ];

  // Raised vs closed, last 6 months.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const trend = months.map((m) => ({
    m,
    label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
    raised: rows.filter((r) => r.reported_at.startsWith(m)).length,
    closed: rows.filter((r) => r.status === "verified_closed" && r.resolution_date?.startsWith(m)).length,
  }));
  const trendMax = Math.max(1, ...trend.flatMap((t) => [t.raised, t.closed]));

  const stages = [
    { label: "Raised → assigned", hours: stats?.avg_report_to_assign_hours ?? null },
    { label: "Assigned → response", hours: stats?.avg_assign_to_response_hours ?? null },
    { label: "Response → corrective action", hours: stats?.avg_response_to_corrective_hours ?? null },
    { label: "Corrective action → verified", hours: stats?.avg_corrective_to_verify_hours ?? null },
  ];
  const stageMax = Math.max(1, ...stages.map((s) => s.hours ?? 0));
  const byPriority = new Map((stats?.by_priority ?? []).map((p) => [p.priority, p]));

  const g = grade(all.score);
  const tiles = [
    { label: "Accountability score", value: all.score === null ? "—" : `${all.score}`, sub: g.label, icon: g.icon, tone: g.color, unit: "/ 100" },
    { label: "Findings raised", value: all.raised.toLocaleString("en-GB"), sub: `${trend[5].raised} this month`, icon: "ph-flag" },
    { label: "Verified & closed", value: `${pct(all.closed, all.raised)}%`, sub: `${all.closed.toLocaleString("en-GB")} of ${all.raised.toLocaleString("en-GB")}`, icon: "ph-seal-check" },
    { label: "Median days to resolve", value: fmtDays(all.medianDays), sub: "From raised to corrective action", icon: "ph-timer" },
    { label: `Open past ${targetDays} days`, value: all.pastTarget.toLocaleString("en-GB"), sub: `of ${all.open.toLocaleString("en-GB")} still open`, icon: "ph-hourglass-medium", warn: all.pastTarget > 0 },
  ] as { label: string; value: string; sub: string; icon: string; warn?: boolean; tone?: string; unit?: string }[];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div>
        <h2 style={{ marginBottom: 2 }}>Accountability Scorecard</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 900 }}>
          Every Finding from the moment it is raised to verified closure: how many, how far along, how fast, and which LGAs, facility
          levels and responsible people are keeping up. Findings are for review, not accusation; the score shows where support is
          needed. Target: verified and closed within {targetDays} days (Master Data → Thresholds).
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        {tiles.map((t) => (
          <div className="card elev-sm" key={t.label} style={{ gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-kicker">{t.label}</span>
              <i className={`ph ${t.icon}`} style={{ color: t.tone ?? (t.warn ? "var(--priority-high)" : "var(--color-accent)") }} aria-hidden="true" />
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {t.value}
              {t.unit && <span style={{ fontSize: 15, fontWeight: 600, marginLeft: 4, color: "var(--color-neutral-700)" }}>{t.unit}</span>}
            </div>
            <div className="card-meta">
              {t.warn ? <Flag level="warning">{t.sub}</Flag> : t.tone ? <span style={{ color: t.tone, fontWeight: 600 }}>{t.sub}</span> : t.sub}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <div className="card elev-sm">
          <div className="card-title">Follow-through</div>
          <div className="text-muted" style={{ fontSize: 12 }}>How far every Finding has travelled, as a share of all raised.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {funnel.map((f) => (
              <div key={f.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 500 }}>{f.label}</span>
                  <span>{f.n.toLocaleString("en-GB")} <span className="text-muted">· {pct(f.n, rows.length)}%</span></span>
                </div>
                <Bar value={f.n} max={rows.length} />
                {f.help && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{f.help}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="card elev-sm">
          <div className="card-title">Raised and closed, last 6 months</div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, marginTop: 4 }} aria-hidden="true">
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--color-accent-500)", marginRight: 4 }} />Raised</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--status-resolved)", marginRight: 4 }} />Verified &amp; closed</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 170, marginTop: 10 }} role="img"
            aria-label={trend.map((t) => `${t.label}: ${t.raised} raised, ${t.closed} closed`).join("; ")}>
            {trend.map((t) => (
              <div key={t.m} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 4 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 2 }}>
                  {([["raised", "var(--color-accent-500)"], ["closed", "var(--status-resolved)"]] as const).map(([k, color]) => (
                    <div key={k} title={`${t.label}: ${t[k]} ${k}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
                      <span style={{ fontSize: 9, visibility: t[k] ? "visible" : "hidden" }}>{t[k]}</span>
                      <div style={{ width: "100%", height: `${(t[k] / trendMax) * 88}%`, minHeight: t[k] ? 2 : 0, background: color, borderRadius: "4px 4px 0 0" }} />
                    </div>
                  ))}
                </div>
                <div className="text-muted" style={{ fontSize: 11, textAlign: "center" }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <div className="card elev-sm">
          <div className="card-title">How fast Findings move</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Average time at each stage.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {stages.map((s) => (
              <div key={s.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span>{s.label}</span>
                  <span className="text-muted">{fmtHours(s.hours)}</span>
                </div>
                <Bar value={s.hours ?? 0} max={stageMax} />
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: 0 }}>
          <div className="card-title" style={{ padding: "14px 16px 0" }}>By priority</div>
          <table className="table" style={{ marginTop: 6 }}>
            <thead><tr><th>Priority</th><th style={{ textAlign: "right" }}>Resolved</th><th style={{ textAlign: "right" }}>Average time to resolve</th></tr></thead>
            <tbody>
              {PRIORITY_ORDER.map((p) => (
                <tr key={p}>
                  <td>{PRIORITY_LABEL[p]}</td>
                  <td style={{ textAlign: "right" }}>{byPriority.get(p)?.resolved_count ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{byPriority.get(p)?.avg_days == null ? "—" : `${byPriority.get(p)!.avg_days} d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <LgaLeague groups={groupBy(rows, (r) => r.lga?.name ?? "No LGA")} targetDays={targetDays} now={now} />
      <ResponsibilityTable title="By facility level" label="Level" groups={groupBy(rows, (r) => r.category?.name ?? "Not set")} targetDays={targetDays} now={now} />

      <ResponsibilityTable title="By responsible person (DRI)" label="DRI" countLabel="Assigned"
        groups={groupBy(rows.filter((r) => r.dri), (r) => r.dri!.name)} targetDays={targetDays} now={now} />
    </div>
  );
}
