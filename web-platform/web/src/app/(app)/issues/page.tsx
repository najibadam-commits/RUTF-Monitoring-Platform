import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { getAllCategories, getCategories, getStates } from "@/lib/queries/lookups";
import { ISSUE_LIST_SELECT, type IssueListRow } from "@/lib/queries/issues";
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_FILTER_OPTIONS, STATUS_LABEL } from "@/lib/constants";
import type { IssuePriority, IssueStatus } from "@/lib/types/database";
import { canCreateIssue } from "@/lib/rbac";
import { StatusTag, PriorityTag } from "@/components/ui/Tags";
import { IssuesFilterBar } from "@/components/issues/IssuesFilterBar";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import { ClickableRow } from "@/components/ui/ClickableRow";
import { ReportIssueButton } from "@/components/issues/ReportIssueButton";
import { RequestDownloadButton } from "@/components/issues/RequestDownloadButton";

const PAGE_SIZE = 10;

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createClient();

  let query = supabase.from("issues").select(ISSUE_LIST_SELECT, { count: "exact" }).order("reported_at", { ascending: false });
  if (sp.status) query = query.eq("status", sp.status as IssueStatus);
  if (sp.priority) query = query.eq("priority", sp.priority as IssuePriority);
  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.state) query = query.eq("state_id", sp.state);
  if (sp.search) query = query.or(`description.ilike.%${sp.search}%,code.ilike.%${sp.search}%`);
  // RUTF auto-Findings (migration 0102): automatic vs registered by a person, and the rule.
  if (sp.source === "auto") query = query.eq("auto_generated", true);
  else if (sp.source === "manual") query = query.eq("auto_generated", false);
  if (sp.type) query = query.eq("finding_type", sp.type);

  const from = (page - 1) * PAGE_SIZE;
  // The paginated issues query, the two independent lookup queries (categories/states), and the
  // signed-in viewer's own profile (used below only for the "Report Finding" button's role
  // check, not a redirect gate) don't depend on each other's results — run all of them
  // concurrently instead of awaiting the profile first and only then starting the rest.
  // categories (active-only, for the "Register Finding" sector picker) vs. filterCategories
  // (every sector, active or legacy — so the filter can still find an old Finding under a
  // category that's since been retired) are deliberately different queries — see getCategories'
  // kdoc.
  const [profile, { data, count }, [categories, filterCategories, states], { data: findingTypes }] = await Promise.all([
    getCurrentProfile(),
    query.range(from, from + PAGE_SIZE - 1),
    Promise.all([getCategories(supabase), getAllCategories(supabase), getStates(supabase)]),
    supabase.from("finding_types").select("key, label").order("label"),
  ]);
  const issues = (data ?? []) as unknown as IssueListRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportParams = new URLSearchParams();
  for (const key of ["status", "priority", "category", "state", "search", "source", "type"] as const) {
    if (sp[key]) exportParams.set(key, sp[key]!);
  }

  function pageHref(p: number) {
    const params = new URLSearchParams();
    for (const key of ["status", "priority", "category", "state", "search", "source", "type"] as const) {
      if (sp[key]) params.set(key, sp[key]!);
    }
    params.set("page", String(p));
    return `/issues?${params.toString()}`;
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Findings Register</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Every Finding — raised automatically from the ledger and visits, or registered by a person · {total} matching
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

      <IssuesFilterBar
        statuses={STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        priorities={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        categories={filterCategories}
        states={states}
        findingTypes={(findingTypes ?? []).map((t) => ({ value: t.key, label: t.label }))}
      />

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Finding ID</th>
              <th>Facility level</th>
              <th>Description</th>
              <th>Location</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assigned DRI</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <ClickableRow key={i.id} href={`/issues/${i.id}`}>
                <td style={{ fontFamily: "var(--font-heading)" }}>
                  {i.code}
                  {i.auto_generated && (
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--color-accent-700)" }}>
                      <i className="ph ph-robot" /> Auto · {i.finding?.label ?? "check"}
                    </div>
                  )}
                </td>
                <td>{i.category?.name ?? "—"}</td>
                <td
                  title={i.description ?? undefined}
                  style={{
                    maxWidth: 260,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textDecoration: "underline",
                    textDecorationColor: "var(--color-divider)",
                    textUnderlineOffset: 3,
                  }}
                >
                  {i.description || "—"}
                </td>
                <td className="text-muted">
                  {i.state?.name ?? "—"}, {i.lga?.name ?? "—"}
                </td>
                <td>
                  <PriorityTag priority={i.priority} />
                </td>
                <td>
                  <StatusTag status={i.status} />
                </td>
                <td className="text-muted">{i.dri?.name ?? "Unassigned"}</td>
                <td className="text-muted">{new Date(i.reported_at).toLocaleDateString()}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
        {issues.length === 0 && (
          <div className="text-muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>
            No issues match these filters.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
          <span className="text-muted" style={{ fontSize: 12.5 }}>
            Page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {page <= 1 ? (
              <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                Previous
              </span>
            ) : (
              <Link className="btn btn-secondary" href={pageHref(page - 1)}>
                Previous
              </Link>
            )}
            {page >= totalPages ? (
              <span className="btn btn-secondary" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                Next
              </span>
            ) : (
              <Link className="btn btn-secondary" href={pageHref(page + 1)}>
                Next
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
