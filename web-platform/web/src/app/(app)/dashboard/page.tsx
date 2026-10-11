import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, STATUS_LABEL, STATUS_COLOR } from "@/lib/constants";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { StatusDot } from "@/components/ui/Tags";
import { DashboardMap } from "@/components/gis/DashboardMap";
import { KpiSections } from "@/components/dashboard/KpiSections";
import { compact } from "@/components/dashboard/Kpi";
import { AttentionPanel } from "@/components/dashboard/AttentionPanel";
import { getKpis, latestLedgerMonth, monthOf, previousMonth } from "@/lib/queries/kpis";
import type { IssueStatus } from "@/lib/types/database";
import { officerText, officerTitle } from "@/lib/rbac";

export const metadata: Metadata = { title: "Overview Dashboard" };

// RUTF dashboard (brief §9): the headline KPIs for a month from rutf_kpis() (migrations
// 0105/0106 — the same definitions test-kpis.js checks against hand-calculated values), then the
// Findings map, status, recent Findings and activity. RLS scopes everything to the viewer.

/** The time "now" for the Finding target — read once per request (a server component). */
const requestTime = () => Date.now();

interface DashboardStats {
  total: number;
  by_status: Partial<Record<IssueStatus, number>>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient();
  const sp = await searchParams;
  const monthKey = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : await latestLedgerMonth(supabase);
  const month = monthOf(monthKey);
  const prevMonth = previousMonth(monthKey);

  const [k, p, { data: statsRaw }, { data: mapRows }, { data: recentIssuesRaw }, { data: timelineRaw }, { data: target }] = await Promise.all([
    getKpis(supabase, month),
    getKpis(supabase, prevMonth),
    supabase.rpc("get_dashboard_stats"),
    supabase.from("issues").select("lat, lng, status").not("lat", "is", null).not("lng", "is", null),
    supabase.from("issues").select("id, code, status, auto_generated, reported_at, finding:finding_types(label), category:categories(name), facility:facilities(name)")
      .order("reported_at", { ascending: false }).limit(6),
    supabase.from("issue_history").select("id, occurred_at, actor_label, action, note, issue:issues(code, facility:facilities(facility_type), category:categories(name))")
      .order("occurred_at", { ascending: false }).limit(8),
    supabase.from("rutf_thresholds").select("value").eq("key", "finding_target_days").limit(1).maybeSingle(),
  ]);
  const targetDays = Number(target?.value ?? 30);
  // Median days from report to verified closure, for Findings closed in the month (DECISIONS R126):
  // the "Verified and closed" history entry is the closing time, as on the Corrective Action Tracker.
  const { data: closuresRaw } = await supabase.from("issue_history").select("occurred_at, issue:issues(reported_at)")
    .eq("action", "Verified and closed").gte("occurred_at", month.start).lte("occurred_at", `${month.end}T23:59:59`);
  const closeDays = ((closuresRaw ?? []) as unknown as { occurred_at: string; issue: { reported_at: string } | null }[])
    .filter((c) => c.issue)
    .map((c) => (Date.parse(c.occurred_at) - Date.parse(c.issue!.reported_at)) / 86_400_000)
    .sort((a, b) => a - b);
  const mid = Math.floor(closeDays.length / 2);
  const closeMedian = {
    days: closeDays.length ? Math.round((closeDays.length % 2 ? closeDays[mid] : (closeDays[mid - 1] + closeDays[mid]) / 2) * 10) / 10 : null,
    n: closeDays.length,
  };
  const { count: pastTarget } = await supabase.from("issues").select("id", { count: "exact", head: true })
    .in("status", OPEN_STATUSES).lt("reported_at", new Date(requestTime() - targetDays * 86_400_000).toISOString());
  const stats = statsRaw as unknown as DashboardStats;
  const byStatus = stats?.by_status ?? {};
  const now = requestTime();

  // Stock on hand, last 6 months (DECISIONS R106): this month and last from above, four more here.
  const trendMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1 - (5 - i), 1));
    return monthOf(d.toISOString().slice(0, 7));
  });
  // A month whose request fails (a passing network error) is tried once more before showing "no data".
  const earlier = await Promise.all(trendMonths.slice(0, 4).map(async (m) => (await getKpis(supabase, m)) ?? getKpis(supabase, m)));
  const sohOf = (x: typeof k) => (x ? (x.stock_on_hand.state_store ?? 0) + (x.stock_on_hand.lga_store ?? 0) + (x.stock_on_hand.otp ?? 0) : null);
  const trend = [...earlier, p, k].map((x, i) => ({
    key: trendMonths[i].key,
    label: new Date(`${trendMonths[i].key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
    soh: sohOf(x),
  }));
  const trendMax = Math.max(1, ...trend.map((t) => t.soh ?? 0));

  // The Findings pipeline in the Corrective Action Tracker's stage colours (R104), with reopened
  // cases as their own red stage, as on the tracker (R133).
  const n = (...ss: IssueStatus[]) => ss.reduce((t, st) => t + (byStatus[st] ?? 0), 0);
  const pipeline = [
    { key: "review", label: "Awaiting review", n: n("new", "pending_review", "returned_for_correction"), color: "var(--color-neutral-500)", href: "/issues?status=pending_review" },
    { key: "assigned", label: "Assigned to facility", n: n("assigned"), color: "var(--stage-assigned)", href: "/issues?status=assigned" },
    { key: "addressing", label: "Being addressed", n: n("in_progress"), color: "var(--stage-addressing)", href: "/issues?status=in_progress" },
    { key: "recorded", label: "Action recorded", n: n("resolved"), color: "var(--stage-recorded)", href: "/issues?status=resolved" },
    { key: "closed", label: "Verified & closed", n: n("verified_closed"), color: "var(--stage-closed)", href: "/issues?status=verified_closed" },
    { key: "reopened", label: "Reopen case", n: n("reopened"), color: "var(--stage-reopened)", href: "/issues?status=reopened" },
  ];
  const pipelineTotal = pipeline.reduce((t, st) => t + st.n, 0);
  // The officer title for a history entry, from its Finding's facility or level (R141).
  const historyOfficer = (issue: unknown) => {
    const i = issue as { facility: { facility_type: string } | null; category: { name: string } | null } | null;
    return officerTitle(i?.facility?.facility_type ?? i?.category?.name);
  };
  const ago = (iso: string) => {
    const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    if (mins < 60) return `${mins} min ago`;
    if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} days ago`;
  };

  // Month choices: the last 12 months.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1 + 6 - i, 1));
    return monthOf(d.toISOString().slice(0, 7));
  }).filter((m) => m.start <= new Date().toISOString().slice(0, 10));


  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      {/* The welcome panel (glass design, R164): gradient, white text, the month picker. */}
      <div className="hero-panel" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "20px 24px" }}>
        <div>
          <h2 style={{ marginBottom: 4, color: "#fff" }}>Overview Dashboard</h2>
          <p style={{ fontSize: 13.5, margin: 0, color: "rgba(255,255,255,.92)" }}>
            Katsina State RUTF pipeline, State store → LGA stores → OTP sites · {month.label} ·{" "}
            {k ? `${k.active_facilities.toLocaleString("en-GB")} stores and OTP sites reporting` : "No data for this month"}
          </p>
        </div>
        <form method="get" style={{ display: "flex", gap: 8 }}>
          <select className="input" name="month" defaultValue={monthKey} aria-label="Month" style={{ minWidth: 170 }}>
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <button className="btn btn-secondary" type="submit">Show</button>
        </form>
      </div>

      {k && <AttentionPanel k={k} pastTarget={pastTarget ?? 0} targetDays={targetDays} monthLabel={month.label} />}

      <KpiSections k={k} p={p} monthLabel={month.label} closeMedian={closeMedian} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 12 }}>
        <div className="card elev-sm" style={{ padding: "12px 14px", gap: 8 }}>
          <div className="card-title" style={{ fontSize: 14 }}>Stock on hand, last 6 months</div>
          <div role="img" aria-label={trend.map((t) => `${t.label}: ${t.soh === null ? "no data" : `${compact(t.soh)} sachets`}`).join("; ")}
            style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 150 }}>
            {trend.map((t) => (
              <div key={t.key} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10.5 }} className={t.soh === null ? "text-muted" : undefined}>{t.soh === null ? "no data" : compact(t.soh)}</span>
                <div title={`${t.label}: ${t.soh === null ? "no data" : `${t.soh.toLocaleString("en-GB")} sachets`}`}
                  style={{ width: "72%", height: `${((t.soh ?? 0) / trendMax) * 78}%`, minHeight: t.soh ? 2 : 0, borderRadius: "4px 4px 0 0",
                    background: t.key === monthKey ? "var(--color-accent-600)" : "var(--color-accent-300)" }} />
                <span className="text-muted" style={{ fontSize: 11 }}>{t.label}</span>
              </div>
            ))}
          </div>
          <div className="kpi-sub">All levels, end of each month · this month highlighted</div>
        </div>

        <div className="card elev-sm" style={{ padding: "12px 14px", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div className="card-title" style={{ fontSize: 14 }}>Findings pipeline</div>
            <Link href="/action-tracker" style={{ fontSize: 12 }}>Corrective Action Tracker <i className="ph ph-arrow-right" aria-hidden="true" /></Link>
          </div>
          <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--color-neutral-100)" }} aria-hidden="true">
            {pipeline.map((st) => st.n > 0 && (
              <span key={st.key} title={`${st.label}: ${st.n}`} style={{ width: `${(st.n * 100) / pipelineTotal}%`, background: st.color }} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {pipeline.map((st) => (
              <Link key={st.key} href={st.href} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, textDecoration: "none", color: "inherit" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: st.color, flex: "none" }} />
                <span style={{ flex: 1 }}>{st.label}</span>
                <strong>{st.n.toLocaleString("en-GB")}</strong>
                <span className="text-muted" style={{ width: 38, textAlign: "right" }}>{pipelineTotal ? `${Math.round((st.n * 100) / pipelineTotal)}%` : "—"}</span>
              </Link>
            ))}
          </div>
          <div className="kpi-sub">{pipelineTotal.toLocaleString("en-GB")} Findings in all · from raised to verified closure</div>
        </div>

        <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 0" }}>
            <div className="card-title" style={{ fontSize: 14 }}>Findings map</div>
            <Link href="/gis" style={{ fontSize: 12 }}>Situation Map <i className="ph ph-arrow-right" /></Link>
          </div>
          <div style={{ position: "relative", height: 200, margin: 10, borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <DashboardMap
              points={(mapRows ?? []).filter((r) => r.lat && r.lng)
                .map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), color: STATUS_COLOR[r.status as IssueStatus] }))}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
        <div className="card elev-sm" style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="card-title" style={{ fontSize: 14 }}>Latest Findings</div>
            <Link href="/issues" style={{ fontSize: 12 }}>Findings Register <i className="ph ph-arrow-right" aria-hidden="true" /></Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
            {(recentIssuesRaw ?? []).map((i) => (
              <Link key={i.id} href={`/issues/${i.id}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--color-divider)", textDecoration: "none", color: "inherit" }}>
                <StatusDot status={i.status as IssueStatus} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(i.finding as unknown as { label: string } | null)?.label ?? (i.category as unknown as { name: string } | null)?.name ?? "—"}
                    {(i.facility as unknown as { name: string } | null)?.name && <span className="text-muted"> · {(i.facility as unknown as { name: string }).name}</span>}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{i.code}{i.auto_generated ? " · automatic check" : ""} · {ago(i.reported_at)}</div>
                </div>
                <span className="text-muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{STATUS_LABEL[i.status as IssueStatus]}</span>
              </Link>
            ))}
            {(recentIssuesRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No Findings yet.</div>}
          </div>
        </div>
        <div className="card elev-sm" style={{ padding: "12px 14px" }}>
          <div className="card-title" style={{ fontSize: 14 }}>Latest activity</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
            {(timelineRaw ?? []).map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: "1px solid var(--color-divider)" }}>
                <div className="text-muted" style={{ fontSize: 11, width: 74, flex: "none" }} title={new Date(h.occurred_at).toLocaleString("en-GB")}>{ago(h.occurred_at)}</div>
                <div style={{ flex: 1, fontSize: 12.5, minWidth: 0 }}>
                  <strong style={{ fontWeight: 600 }}>{officerText(h.action, historyOfficer(h.issue))}</strong>{h.note ? <span className="text-muted"> — {officerText(h.note, historyOfficer(h.issue))}</span> : null}
                  <div className="text-muted" style={{ fontSize: 11 }}>{(h.issue as unknown as { code: string } | null)?.code} · {h.actor_label}</div>
                </div>
              </div>
            ))}
            {(timelineRaw ?? []).length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 0" }}>No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
