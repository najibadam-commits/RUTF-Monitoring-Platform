import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getAllCategories, getCategories, getProgrammeLgas, getProgrammeStates } from "@/lib/queries/lookups";
import { ISSUE_FILTER_KEYS, ISSUE_LIST_SELECT, applyIssueFilters, getFindingTargetDays, type IssueFilters, type IssueListRow } from "@/lib/queries/issues";
import { OPEN_STATUSES, PRIORITY_LABEL, PRIORITY_ORDER, STATUS_FILTER_OPTIONS, STATUS_LABEL } from "@/lib/constants";
import type { IssueStatus } from "@/lib/types/database";
import { canCreateIssue } from "@/lib/rbac";
import { StatusTag, PriorityTag } from "@/components/ui/Tags";
import { IssuesFilterBar } from "@/components/issues/IssuesFilterBar";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { ClickableRow } from "@/components/ui/ClickableRow";
import { ReportIssueButton } from "@/components/issues/ReportIssueButton";
import { RequestDownloadButton } from "@/components/issues/RequestDownloadButton";

export const metadata: Metadata = { title: "Findings Register" };

// Findings Register (DECISIONS R84): summary cards that double as filters (open, critical, past
// the Finding target, raised automatically, verified & closed), then the filtered list with each
// Finding's facility, ward and age against the target. The same filters drive the export.

const PAGE_SIZE = 20;
const DAY = 86_400_000;

/** The time "now" for ages and the target — read once per request (a server component). */
const requestTime = () => Date.now();

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();
  const now = requestTime();
  const targetDays = await getFindingTargetDays(supabase);
  const filters: IssueFilters = Object.fromEntries(ISSUE_FILTER_KEYS.flatMap((k) => (sp[k] ? [[k, sp[k]!]] : [])));

  const query = applyIssueFilters(
    supabase.from("issues").select(ISSUE_LIST_SELECT, { count: "exact" }).order("reported_at", { ascending: false }),
    filters,
    targetDays,
    now,
  );
  // Summary-card counts (RLS-scoped, independent of the filters below them).
  const head = () => supabase.from("issues").select("id", { count: "exact", head: true });
  const cutoff = new Date(now - targetDays * DAY).toISOString();

  const from = (page - 1) * PAGE_SIZE;
  // categories (active-only, for the "Register Finding" picker) vs. filterCategories (every level,
  // active or legacy — so the filter can still find an old Finding under a retired category) are
  // deliberately different queries — see getCategories' kdoc.
  const [profile, { data, count }, [categories, filterCategories, states], { data: findingTypes }, counts, lgas, { data: openTypes }] = await Promise.all([
    getCurrentProfile(),
    query.range(from, from + PAGE_SIZE - 1),
    Promise.all([getCategories(supabase), getAllCategories(supabase), getProgrammeStates(supabase)]),
    supabase.from("finding_types").select("key, label").order("label"),
    Promise.all([
      head(),
      head().in("status", OPEN_STATUSES),
      head().in("status", OPEN_STATUSES).eq("priority", "critical"),
      head().in("status", OPEN_STATUSES).lt("reported_at", cutoff),
      head().eq("auto_generated", true),
      head().eq("status", "verified_closed"),
    ]).then((rs) => rs.map((r) => r.count ?? 0)),
    getProgrammeLgas(supabase),
    // Open Findings by type, for "What is being found" (R107).
    supabase.from("issues").select("finding_type, auto_generated").in("status", OPEN_STATUSES).limit(5000),
  ]);
  const typeLabel = Object.fromEntries((findingTypes ?? []).map((t) => [t.key, t.label]));
  const byType = new Map<string, { n: number; auto: number }>();
  for (const r of openTypes ?? []) {
    const k = r.finding_type ?? "registered";
    const v = byType.get(k) ?? { n: 0, auto: 0 };
    v.n += 1;
    if (r.auto_generated) v.auto += 1;
    byType.set(k, v);
  }
  const typeChips = [...byType].sort((a, b) => b[1].n - a[1].n);
  const [all, open, critical, overdue, auto, closed] = counts;
  const issues = (data ?? []) as unknown as IssueListRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportParams = new URLSearchParams(filters as Record<string, string>);

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(filters as Record<string, string>);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/issues?${qs}` : "/issues";
  }
  const pct = (n: number) => (all ? Math.round((n * 100) / all) : 0);
  const cards: { key: string; label: string; value: number; sub: string; icon: string; href: string; active: boolean; tone?: string }[] = [
    { key: "open", label: "Open", value: open, sub: `of ${all.toLocaleString("en-GB")} raised`, icon: "ph-flag", href: hrefWith({ view: filters.view === "open" ? null : "open", status: null }), active: filters.view === "open" },
    { key: "critical", label: "Critical and open", value: critical, sub: "Needs review first", icon: "ph-warning-octagon", href: hrefWith({ view: filters.view === "critical" ? null : "critical", priority: null, status: null }), active: filters.view === "critical", tone: critical ? "var(--priority-critical)" : undefined },
    { key: "overdue", label: `Open past ${targetDays} days`, value: overdue, sub: "The Finding target", icon: "ph-hourglass-medium", href: hrefWith({ view: filters.view === "overdue" ? null : "overdue", status: null }), active: filters.view === "overdue", tone: overdue ? "var(--priority-high)" : undefined },
    { key: "auto", label: "Raised automatically", value: auto, sub: `${pct(auto)}% from ledger and visit checks`, icon: "ph-robot", href: hrefWith({ source: filters.source === "auto" ? null : "auto" }), active: filters.source === "auto" },
    { key: "closed", label: "Verified & closed", value: closed, sub: `${pct(closed)}% of all Findings`, icon: "ph-seal-check", href: hrefWith({ status: filters.status === "verified_closed" ? null : "verified_closed", view: null }), active: filters.status === "verified_closed", tone: closed ? "var(--status-resolved)" : undefined },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Findings Register</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Every discrepancy, raised automatically from the ledger and supervision visits or registered by a person, with
            its status and owner until it is verified and closed. Findings are for review, not accusation.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {canCreateIssue(profile.role) && <ReportIssueButton categories={categories} states={states} />}
          {profile.role === "viewer" ? (
            <RequestDownloadButton filters={Object.fromEntries(exportParams)} />
          ) : (
            <a className="btn btn-secondary" href={`/issues/export?${exportParams.toString()}`}>
              <i className="ph ph-download-simple" />
              Export CSV
            </a>
          )}
        </div>
      </div>

      <div className="kpi-row">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} className="card elev-sm kpi-card" aria-pressed={c.active}
            title={c.active ? "Clear this filter" : `Show ${c.label.toLowerCase()} Findings`}
            style={{ textDecoration: "none", color: "inherit", outline: c.active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
            <div className="kpi-label">
              <i className={`ph-fill ${c.icon}`} aria-hidden="true" style={{ color: c.tone ?? "var(--color-accent-600)" }} /> {c.label}
            </div>
            <div className="kpi-value">{c.value.toLocaleString("en-GB")}</div>
            <div className="kpi-sub">{c.active ? "Filtered · click to clear" : c.sub}</div>
          </Link>
        ))}
      </div>

      {typeChips.length > 0 && (
        <div className="card elev-sm" style={{ padding: "10px 12px", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div className="card-title" style={{ fontSize: 13.5 }}>What is being found</div>
            <span className="kpi-sub">Open Findings by type · the robot marks automatic checks, run nightly on the ledger and at every supervision visit</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {typeChips.map(([key, v]) => {
              const active = key !== "registered" && filters.type === key && filters.view === "open";
              const label = key === "registered" ? "Registered by a person" : typeLabel[key] ?? key;
              return (
                <Link key={key} href={key === "registered" ? hrefWith({ source: "manual", view: "open", type: null }) : hrefWith({ type: active ? null : key, view: active ? null : "open", status: null })}
                  aria-pressed={active}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12.5, textDecoration: "none",
                    color: "inherit", border: "1px solid var(--color-divider)", background: active ? "var(--color-accent-100)" : "var(--color-surface)" }}>
                  {v.auto > 0 && <i className="ph ph-robot" aria-hidden="true" style={{ color: "var(--color-accent-700)" }} />}
                  {label}
                  <strong>{v.n.toLocaleString("en-GB")}</strong>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <IssuesFilterBar
        statuses={STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        priorities={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        categories={filterCategories}
        states={states}
        lgas={lgas.map((l) => ({ id: l.id, name: l.name }))}
        findingTypes={(findingTypes ?? []).map((t) => ({ value: t.key, label: t.label }))}
      />

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Finding ID</th>
              <th>Finding</th>
              <th>Facility</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assigned to</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => {
              const isOpen = OPEN_STATUSES.includes(i.status as IssueStatus);
              const days = Math.floor((now - Date.parse(i.reported_at)) / DAY);
              const late = isOpen && days > targetDays;
              return (
                <ClickableRow key={i.id} href={`/issues/${i.id}`}>
                  <td style={{ fontFamily: "var(--font-heading)", whiteSpace: "nowrap" }}>
                    {i.code}
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: i.auto_generated ? "var(--color-accent-700)" : "var(--color-neutral-600)" }}>
                      {i.auto_generated ? <><i className="ph ph-robot" aria-hidden="true" /> Automatic check</> : <><i className="ph ph-user" aria-hidden="true" /> Registered</>}
                    </div>
                  </td>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{i.finding?.label ?? i.category?.name ?? "Finding"}</div>
                    <div className="text-muted" title={i.description ?? undefined}
                      style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {i.description || "—"}
                    </div>
                  </td>
                  <td style={{ maxWidth: 240 }}>
                    <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.facility?.name ?? i.category?.name ?? "—"}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {[i.lga?.name, i.ward_ref?.name].filter(Boolean).join(" · ") || i.state?.name || "—"}
                    </div>
                  </td>
                  <td>
                    <PriorityTag priority={i.priority} />
                  </td>
                  <td>
                    <StatusTag status={i.status} />
                  </td>
                  <td className="text-muted">{i.dri?.name ?? "Unassigned"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div className="text-muted" style={{ fontSize: 12.5 }}>
                      {new Date(i.reported_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                    {isOpen && (
                      <div style={{ fontSize: 11.5, color: late ? "var(--priority-high)" : "var(--color-neutral-600)", fontWeight: late ? 600 : 400 }}>
                        {late && <i className="ph-fill ph-hourglass-medium" aria-hidden="true" />} {days} {days === 1 ? "day" : "days"} open{late ? " · past target" : ""}
                      </div>
                    )}
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
        {issues.length === 0 && (
          <div className="text-muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>
            No Findings match these filters.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
          <span className="text-muted" style={{ fontSize: 12.5 }}>
            {total.toLocaleString("en-GB")} {total === 1 ? "Finding" : "Findings"} · page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {page <= 1 ? (
              <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                Previous
              </span>
            ) : (
              <Link className="btn btn-secondary" href={hrefWith({ page: String(page - 1) })}>
                Previous
              </Link>
            )}
            {page >= totalPages ? (
              <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                Next
              </span>
            ) : (
              <Link className="btn btn-secondary" href={hrefWith({ page: String(page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
