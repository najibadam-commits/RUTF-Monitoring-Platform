import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessActionTracker } from "@/lib/rbac";
import { getFindingTargetDays } from "@/lib/queries/issues";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { PriorityTag } from "@/components/ui/Tags";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import type { IssuePriority, IssueStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Corrective Action Tracker" };

// Corrective Action Tracker (DECISIONS R85): approved Findings on a board by stage — assigned to the
// facility, being addressed, action recorded (awaiting verification), and verified & closed in the
// last 30 days — oldest and past-target first, with the headline figures and who holds the open
// actions. Every card opens the Finding.

const DAY = 86_400_000;
const PER_COLUMN = 8;
const RECENT_DAYS = 30;

/** The time "now" for ages and the target — read once per request (a server component). */
const requestTime = () => Date.now();

type Row = {
  id: string;
  code: string;
  status: IssueStatus;
  priority: IssuePriority;
  reported_at: string;
  resolution_date: string | null;
  /** When it was verified and closed (from issue_history), for the closed column. */
  closed_at?: string;
  finding: { label: string } | null;
  category: { name: string } | null;
  facility: { name: string } | null;
  lga_id: string;
  lga: { name: string } | null;
  ward_ref: { name: string } | null;
  dri: { name: string } | null;
};

const SELECT =
  "id, code, status, priority, reported_at, resolution_date, lga_id, finding:finding_types(label), category:categories(name), facility:facilities(name), lga:lgas(name), ward_ref:wards(name), dri:profiles!issues_assigned_dri_fkey(name)";

// Stage colours (DECISIONS R104, R133): blue, orange, green, black, and red for a reopened case —
// tokens in globals.css. A Finding the supervisor could not verify (status "reopened") has its own
// stage, so it stands out until the responsible person acts on it again.
const COLUMNS: { key: string; title: string; hint: string; statuses: IssueStatus[]; icon: string; color: string }[] = [
  { key: "assigned", title: "Assigned to facility", hint: "Awaiting the facility's response", statuses: ["assigned"], icon: "ph-user-focus", color: "var(--stage-assigned)" },
  { key: "in_progress", title: "Being addressed", hint: "Corrective action under way", statuses: ["in_progress"], icon: "ph-wrench", color: "var(--stage-addressing)" },
  { key: "resolved", title: "Action recorded", hint: "Awaiting supervisor verification", statuses: ["resolved"], icon: "ph-clipboard-text", color: "var(--stage-recorded)" },
  { key: "closed", title: "Verified & closed", hint: `In the last ${RECENT_DAYS} days`, statuses: ["verified_closed"], icon: "ph-seal-check", color: "var(--stage-closed)" },
  { key: "reopened", title: "Reopen case", hint: "Fix not verified: needs action again", statuses: ["reopened"], icon: "ph-arrow-counter-clockwise", color: "var(--stage-reopened)" },
];

const PRIORITY_RANK: Record<IssuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default async function ActionTrackerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!canAccessActionTracker(profile.role)) redirect("/dashboard");
  // Focus for a follow-up meeting (DECISIONS R108): an LGA, a responsible person, past target only.
  const sp = await searchParams;

  const supabase = await createClient();
  const now = requestTime();
  const since = new Date(now - RECENT_DAYS * DAY).toISOString();
  // Closed in the last 30 days: the verification time is the "Verified and closed" history entry
  // (verify_and_close_issue), not updated_at, which other edits also move.
  const [targetDays, { data: openRaw }, { data: verifiedRaw }, lgas] = await Promise.all([
    getFindingTargetDays(supabase),
    supabase.from("issues").select(SELECT).in("status", ["assigned", "in_progress", "resolved", "reopened"]).order("reported_at"),
    supabase.from("issue_history").select("issue_id, occurred_at").eq("action", "Verified and closed").gte("occurred_at", since).order("occurred_at", { ascending: false }),
    getProgrammeLgas(supabase),
  ]);
  const closedAt = new Map<string, string>();
  for (const h of verifiedRaw ?? []) if (!closedAt.has(h.issue_id)) closedAt.set(h.issue_id, h.occurred_at);
  const { data: closedRaw } = closedAt.size
    ? await supabase.from("issues").select(SELECT).eq("status", "verified_closed").in("id", [...closedAt.keys()])
    : { data: [] };
  const age = (r: Row) => Math.floor((now - Date.parse(r.reported_at)) / DAY);
  const daysToClose = (r: Row) => Math.max(0, Math.round((Date.parse(r.closed_at ?? r.resolution_date ?? r.reported_at) - Date.parse(r.reported_at)) / DAY));
  const late = (r: Row) => age(r) > targetDays;
  const ownerOf = (r: Row) => r.dri?.name ?? "Unassigned";

  const inLga = (r: Row) => !sp.lga || r.lga_id === sp.lga;
  const openInLga = ((openRaw ?? []) as unknown as Row[]).filter(inLga);
  // Every stage and figure below follows the focus; "Who holds the open actions" keeps every person
  // in the LGA so you can switch between them.
  const open = openInLga.filter((r) => (!sp.owner || ownerOf(r) === sp.owner) && (sp.late !== "1" || late(r)));
  const closed = ((closedRaw ?? []) as unknown as Row[])
    .map((r) => ({ ...r, closed_at: closedAt.get(r.id) }))
    .filter((r) => inLga(r) && (!sp.owner || ownerOf(r) === sp.owner) && (sp.late !== "1" || daysToClose(r) > targetDays))
    .sort((a, b) => Date.parse(b.closed_at ?? "") - Date.parse(a.closed_at ?? ""));
  const focused = !!(sp.lga || sp.owner || sp.late === "1");
  const lgaName = sp.lga ? lgas.find((l) => l.id === sp.lga)?.name : null;
  const focusHref = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/action-tracker?${qs}` : "/action-tracker";
  };

  const pastTarget = open.filter(late).length;
  const closeDays = closed.map(daysToClose).sort((a, b) => a - b);
  const medianClose = closeDays.length ? closeDays[Math.floor((closeDays.length - 1) / 2)] : null;
  const onTime = closed.length ? Math.round((closed.filter((r) => daysToClose(r) <= targetDays).length * 100) / closed.length) : null;

  // Who holds the open actions: per responsible person, open and past target.
  const owners = new Map<string, { open: number; late: number }>();
  for (const r of openInLga) {
    const name = ownerOf(r);
    const o = owners.get(name) ?? { open: 0, late: 0 };
    o.open += 1;
    if (late(r)) o.late += 1;
    owners.set(name, o);
  }
  const ownerRows = [...owners].sort((a, b) => b[1].late - a[1].late || b[1].open - a[1].open).slice(0, 10);
  const ownerNames = [...owners.keys()].sort((a, b) => a.localeCompare(b));

  const stats = [
    { label: "Open corrective actions", value: open.length.toLocaleString("en-GB"), sub: "Assigned, being addressed, awaiting verification or reopened", icon: "ph-flag" },
    { label: `Past the ${targetDays}-day target`, value: pastTarget.toLocaleString("en-GB"), sub: open.length ? `${Math.round((pastTarget * 100) / open.length)}% of open actions` : "None open", icon: "ph-hourglass-medium", tone: pastTarget ? "var(--priority-high)" : undefined },
    { label: `Closed in the last ${RECENT_DAYS} days`, value: closed.length.toLocaleString("en-GB"), sub: onTime === null ? "None closed yet" : `${onTime}% within the target`, icon: "ph-seal-check", tone: closed.length ? "var(--status-resolved)" : undefined },
    { label: "Median days to close", value: medianClose === null ? "—" : String(medianClose), sub: `Findings closed in the last ${RECENT_DAYS} days`, icon: "ph-timer" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Corrective Action Tracker</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Every approved Finding, from the facility&apos;s response to a supervisor&apos;s verification. Oldest and past-target
            actions come first in each stage; target {targetDays} days from report to verified closure.
          </p>
        </div>
        <Link href="/accountability" className="btn btn-secondary">
          <i className="ph ph-seal-check" /> Accountability Scorecard
        </Link>
      </div>

      <form method="get" className="filter-bar" style={{ flexWrap: "wrap" }}>
        <select className="input" name="lga" defaultValue={sp.lga ?? ""} aria-label="LGA" style={{ maxWidth: 180 }}>
          <option value="">All LGAs</option>
          {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input" name="owner" defaultValue={sp.owner ?? ""} aria-label="Responsible person" style={{ maxWidth: 230 }}>
          <option value="">Every responsible person</option>
          {ownerNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="late" value="1" defaultChecked={sp.late === "1"} /> Past target only
        </label>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {focused && <Link className="btn btn-secondary" href="/action-tracker"><i className="ph ph-x-circle" /> Clear</Link>}
        {focused && (
          <span className="text-muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
            Showing {[lgaName && `${lgaName} LGA`, sp.owner, sp.late === "1" && "past target only"].filter(Boolean).join(" · ")}
          </span>
        )}
      </form>

      <div className="kpi-row">
        {stats.map((s) => (
          <div key={s.label} className="card elev-sm kpi-card">
            <div className="kpi-label">
              <i className={`ph-fill ${s.icon}`} aria-hidden="true" style={{ color: s.tone ?? "var(--color-accent-600)" }} /> {s.label}
            </div>
            <div className="kpi-value">{s.value}</div>
            <div className="kpi-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Five stages on one row where the screen allows (R104, R133); they wrap three, two, then one across. */}
      <div className="stage-board">
        {COLUMNS.map((col) => {
          const all = col.key === "closed" ? closed : open.filter((r) => col.statuses.includes(r.status));
          // Open stages: past target first, then priority, then oldest. Closed: most recent first.
          const cards = col.key === "closed" ? all : [...all].sort((a, b) => Number(late(b)) - Number(late(a)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || age(b) - age(a));
          const color = col.color;
          const moreHref = col.key === "closed" ? "/issues?status=verified_closed" : `/issues?status=${col.statuses[0]}`;
          return (
            <section key={col.key} aria-label={col.title} style={{ background: `color-mix(in srgb, ${color} 6%, var(--color-neutral-100))`, borderRadius: "var(--radius-lg)", padding: 6, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <div style={{ padding: "6px 8px 5px", borderRadius: 7, background: color, color: "#fff", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <i className={`ph-fill ${col.icon}`} aria-hidden="true" style={{ fontSize: 14, flex: "none" }} />
                  <h3 style={{ fontSize: 12.5, margin: 0, flex: 1, minWidth: 0, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{col.title}</h3>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, flex: "none" }}>{all.length.toLocaleString("en-GB")}</span>
                </div>
                <div style={{ fontSize: 10.5, marginTop: 1, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={col.hint}>{col.hint}</div>
              </div>
              {cards.slice(0, PER_COLUMN).map((r) => {
                const days = age(r);
                const isLate = col.key !== "closed" && late(r);
                return (
                  <Link key={r.id} href={`/issues/${r.id}`} className="card elev-sm"
                    style={{ padding: "7px 8px", gap: 2, textDecoration: "none", color: "inherit", borderLeft: `4px solid ${color}`, background: `color-mix(in srgb, ${color} 5%, var(--color-surface))` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font-heading)", fontSize: 11, color: "var(--color-neutral-700)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.code}</span>
                      {(r.priority === "critical" || r.priority === "high") && <PriorityTag priority={r.priority} />}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.finding?.label ?? r.category?.name ?? "Finding"}</div>
                    <div className="text-muted" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.facility?.name ?? "—"}{r.lga?.name ? ` · ${r.lga.name}` : ""}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 11 }}>
                      <span className="text-muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <i className="ph ph-user" aria-hidden="true" /> {r.dri?.name ?? "Unassigned"}
                      </span>
                      {col.key === "closed" ? (
                        <span style={{ color: "var(--status-resolved)", whiteSpace: "nowrap" }}>Closed in {daysToClose(r)} d</span>
                      ) : (
                        <span style={{ whiteSpace: "nowrap", color: isLate ? "var(--priority-critical)" : "var(--color-neutral-600)", fontWeight: isLate ? 600 : 400 }}
                          title={isLate ? "Past the target" : undefined}>
                          {isLate && <i className="ph-fill ph-hourglass-medium" aria-hidden="true" />} {days} d open{isLate ? " · late" : ""}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
              {all.length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "6px 4px" }}>Nothing at this stage.</div>}
              {all.length > PER_COLUMN && (
                <Link href={moreHref} style={{ fontSize: 12, padding: "2px 4px", color }}>
                  {(all.length - PER_COLUMN).toLocaleString("en-GB")} more in the Findings Register <i className="ph ph-arrow-right" aria-hidden="true" />
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 4px" }}>
          <div className="card-title">Who holds the open actions</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            The responsible person (DRI) for each open corrective action{lgaName ? ` in ${lgaName}` : ""}, most past target first. Click a name to see only their actions.
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Responsible person</th>
              <th style={{ textAlign: "right" }}>Open</th>
              <th style={{ textAlign: "right" }}>Past target</th>
            </tr>
          </thead>
          <tbody>
            {ownerRows.map(([name, o]) => (
              <tr key={name} style={sp.owner === name ? { background: "var(--color-accent-100)" } : undefined}>
                <td><Link href={focusHref({ owner: sp.owner === name ? null : name })}>{name}</Link></td>
                <td style={{ textAlign: "right" }}>{o.open.toLocaleString("en-GB")}</td>
                <td style={{ textAlign: "right", color: o.late ? "var(--priority-high)" : undefined, fontWeight: o.late ? 600 : 400 }}>{o.late.toLocaleString("en-GB")}</td>
              </tr>
            ))}
            {ownerRows.length === 0 && (
              <tr>
                <td colSpan={3} className="text-muted" style={{ textAlign: "center", padding: 20 }}>No open corrective actions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
