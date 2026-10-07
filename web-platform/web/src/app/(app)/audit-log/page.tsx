import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessAuditLog, ROLE_LABELS } from "@/lib/rbac";
import type { SP } from "@/components/reports/ReportShell";
import type { UserRole } from "@/lib/types/database";

export const metadata: Metadata = { title: "Audit Trail" };

// Audit Trail (brief §10, migration 0108; DECISIONS R120): who changed reference data, user access,
// DHIS2 uploads and ledger / transfer status, with the old and new values. Ledger entries themselves
// are append-only and carry their recorder; this covers everything around them. Summary tiles, filters
// by area, who and period, changes in plain words, and the automated permission-test accounts folded
// away by default (shown on request — nothing is hidden from the record).

const TABLES: Record<string, string> = {
  facilities: "Facilities",
  product_lots: "Lots",
  protocol_rules: "Dosing rules",
  rutf_thresholds: "Thresholds",
  profiles: "User accounts",
  supervisor_lgas: "Supervisor LGAs",
  dhis2_reports: "DHIS2 reports",
  stock_transactions: "Ledger entries",
  transfers: "Transfers",
};
const AREA_ICON: Record<string, string> = {
  facilities: "ph-buildings", product_lots: "ph-package", protocol_rules: "ph-list-checks", rutf_thresholds: "ph-sliders-horizontal",
  profiles: "ph-user-gear", supervisor_lgas: "ph-map-pin", dhis2_reports: "ph-cloud-arrow-up", stock_transactions: "ph-book-open-text", transfers: "ph-truck",
};
const FIELD: Record<string, string> = {
  role: "Role", status: "Status", name: "Name", email: "Email", phone: "Phone", facility_id: "Facility", project_id: "Programme",
  supervision_level: "Supervision level", managed_state_id: "State", value: "Value", note: "Note", lot_no: "Lot", expiry_date: "Expiry",
  is_otp_site: "OTP site", is_active: "Active", is_hard_to_reach: "Hard to reach", lat: "Latitude", lng: "Longitude", ward_id: "Ward",
  lga_id: "LGA", supplied_by_facility_id: "Supplied by", void_reason: "Void reason", received_date: "Received", sachets_received: "Sachets received",
};
/** Bookkeeping fields that say nothing about the change itself. */
const NOISE = new Set(["id", "created_at", "updated_at", "last_login", "initials", "assigned_category_id", "pending_data", "submitted_by", "reviewed_by"]);
const PAGE = 100;
const DAY = 86_400_000;

/** The time "now" for the period filter — read once per request (a server component). */
const requestTime = () => Date.now();

const isTestAccount = (changes: unknown) => /rbactest|RBAC TEST/i.test(JSON.stringify(changes ?? {}));

function show(key: string, x: unknown): string {
  if (x === null || x === undefined || x === "") return "—";
  if (key === "role" && typeof x === "string") return ROLE_LABELS[x as UserRole] ?? x;
  if (typeof x === "boolean") return x ? "yes" : "no";
  if (typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)) return "another record";
  if (typeof x === "object") return JSON.stringify(x);
  return String(x).replace(/_/g, " ");
}

function summarise(table: string, action: string, changes: unknown) {
  const c = (changes ?? {}) as Record<string, unknown>;
  if (action === "insert" || action === "delete") {
    const name = c.name ?? c.lot_no ?? c.key ?? c.code ?? c.period;
    const verb = action === "insert" ? "Added" : "Removed";
    if (table === "profiles") return `${verb} account ${name ?? ""}${c.role ? ` (${show("role", c.role)})` : ""}`;
    if (table === "rutf_thresholds") return `${action === "insert" ? "Set" : "Removed"} ${String(c.key ?? "a threshold").replace(/_/g, " ")}${c.value !== undefined && action === "insert" ? ` to ${c.value}` : ""}`;
    return `${verb}${name ? ` ${String(name)}` : ""}`;
  }
  const parts = Object.entries(c)
    .filter(([k]) => !NOISE.has(k))
    .map(([k, v]) => {
      const [o, n] = Array.isArray(v) ? v : [null, v];
      return `${FIELD[k] ?? k.replace(/_/g, " ")}: ${show(k, o)} → ${show(k, n)}`;
    });
  return parts.length ? parts.join("; ") : "Updated";
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  if (!canAccessAuditLog(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const showTests = sp.tests === "1";
  const days = ["7", "30", "90"].includes(sp.days ?? "") ? Number(sp.days) : null;
  const supabase = await createClient();
  const now = requestTime();

  // The whole trail is small; read it once (newest first) for the tiles, filters and pages.
  const all: { id: number; at: string; actor: string | null; table_name: string; row_id: string | null; action: string; changes: unknown }[] = [];
  let error: { message: string } | null = null;
  for (let from = 0; ; from += 1000) {
    const res = await supabase.from("audit_log").select("id, at, actor, table_name, row_id, action, changes").order("at", { ascending: false }).range(from, from + 999);
    if (res.error) { error = res.error; break; }
    all.push(...((res.data ?? []) as typeof all));
    if (!res.data || res.data.length < 1000) break;
  }
  // A test account's other entries (e.g. its role changes) are recognised by the account they touch.
  const testRows = new Set(all.filter((r) => isTestAccount(r.changes) && r.row_id).map((r) => r.row_id));
  const isTest = (r: (typeof all)[number]) => isTestAccount(r.changes) || (!!r.row_id && testRows.has(r.row_id));
  const tests = all.filter(isTest).length;
  const base = showTests ? all : all.filter((r) => !isTest(r));
  const filtered = base
    .filter((r) => !sp.table || r.table_name === sp.table)
    .filter((r) => !sp.row || r.row_id === sp.row)
    .filter((r) => (sp.who === "people" ? !!r.actor : sp.who === "platform" ? !r.actor : true))
    .filter((r) => !days || now - Date.parse(r.at) <= days * DAY);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  const actors = [...new Set(rows.map((r) => r.actor).filter((a): a is string => !!a))];
  const { data: people } = actors.length ? await supabase.from("profiles").select("id, name").in("id", actors) : { data: [] };
  const who = Object.fromEntries((people ?? []).map((p) => [p.id, p.name]));

  const last30 = base.filter((r) => now - Date.parse(r.at) <= 30 * DAY);
  const byArea = new Map<string, number>();
  for (const r of base) byArea.set(r.table_name, (byArea.get(r.table_name) ?? 0) + 1);
  const areas = [...byArea].sort((a, b) => b[1] - a[1]);

  const params = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== "page"));
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `/audit-log?${qs}` : "/audit-log";
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Audit Trail</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 880 }}>
          Every change to facilities, lots, dosing rules, thresholds, user access, supervisor LGAs and DHIS2 uploads, and every
          status change on ledger entries and transfers — who, when, and the old and new values. Entries are written by the
          database itself whenever one of these changes, so an edit can&apos;t skip the trail, and no one can change or remove an
          entry through the app or the API.
          &quot;Platform&quot; means an import, a test run or the nightly job.
        </p>
      </div>

      <div className="kpi-row">
        <div className="card elev-sm kpi-card">
          <div className="kpi-label"><i className="ph-fill ph-clock-counter-clockwise" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> Changes recorded</div>
          <div className="kpi-value">{base.length.toLocaleString("en-GB")}</div>
          <div className="kpi-sub">{last30.length.toLocaleString("en-GB")} in the last 30 days</div>
        </div>
        <Link href={params({ who: sp.who === "people" ? null : "people" })} className="card elev-sm kpi-card" aria-pressed={sp.who === "people"}
          style={{ textDecoration: "none", color: "inherit", outline: sp.who === "people" ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
          <div className="kpi-label"><i className="ph-fill ph-user" aria-hidden="true" style={{ color: "var(--color-accent-600)" }} /> By people</div>
          <div className="kpi-value">{base.filter((r) => r.actor).length.toLocaleString("en-GB")}</div>
          <div className="kpi-sub">{sp.who === "people" ? "Filtered · click to clear" : "Signed-in users, by name"}</div>
        </Link>
        <Link href={params({ who: sp.who === "platform" ? null : "platform" })} className="card elev-sm kpi-card" aria-pressed={sp.who === "platform"}
          style={{ textDecoration: "none", color: "inherit", outline: sp.who === "platform" ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
          <div className="kpi-label"><i className="ph-fill ph-gear" aria-hidden="true" style={{ color: "var(--color-neutral-600)" }} /> By the platform</div>
          <div className="kpi-value">{base.filter((r) => !r.actor).length.toLocaleString("en-GB")}</div>
          <div className="kpi-sub">{sp.who === "platform" ? "Filtered · click to clear" : "Imports, tests and nightly jobs"}</div>
        </Link>
        <div className="card elev-sm kpi-card">
          <div className="kpi-label"><i className="ph-fill ph-shield-check" aria-hidden="true" style={{ color: "var(--status-resolved)" }} /> Areas covered</div>
          <div className="kpi-value">{Object.keys(TABLES).length}</div>
          <div className="kpi-sub">{areas.length} with changes so far</div>
        </div>
      </div>

      {areas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {areas.map(([t, n]) => {
            const active = sp.table === t;
            return (
              <Link key={t} href={params({ table: active ? null : t })} aria-pressed={active}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12.5, textDecoration: "none", color: "inherit",
                  border: "1px solid var(--color-divider)", background: active ? "var(--color-accent-100)" : "var(--color-surface)" }}>
                <i className={`ph ${AREA_ICON[t] ?? "ph-circle"}`} aria-hidden="true" /> {TABLES[t] ?? t} <strong>{n.toLocaleString("en-GB")}</strong>
              </Link>
            );
          })}
        </div>
      )}

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <select className="input" name="table" defaultValue={sp.table ?? ""} aria-label="What changed" style={{ maxWidth: 200 }}>
          <option value="">Everything</option>
          {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" name="who" defaultValue={sp.who ?? ""} aria-label="Who" style={{ maxWidth: 190 }}>
          <option value="">People and the platform</option>
          <option value="people">People only</option>
          <option value="platform">The platform only</option>
        </select>
        <select className="input" name="days" defaultValue={sp.days ?? ""} aria-label="Period" style={{ maxWidth: 160 }}>
          <option value="">Any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        {showTests && <input type="hidden" name="tests" value="1" />}
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {(sp.table || sp.who || sp.days || sp.row) && <Link className="btn btn-secondary" href={showTests ? "/audit-log?tests=1" : "/audit-log"}><i className="ph ph-x-circle" /> Clear</Link>}
        <span className="text-muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>{filtered.length.toLocaleString("en-GB")} changes</span>
      </form>

      {tests > 0 && (
        <div className="text-muted" style={{ fontSize: 12.5 }}>
          <i className="ph ph-flask" aria-hidden="true" />{" "}
          {showTests
            ? <>Showing {tests} entries from the automated permission tests (temporary test accounts). <Link href={params({ tests: null })}>Fold them away</Link></>
            : <>{tests} entries from the automated permission tests (temporary test accounts) are folded away. <Link href={params({ tests: "1" })}>Show them</Link></>}
        </div>
      )}

      {error && <p style={{ color: "var(--priority-critical)" }}>The audit trail couldn&apos;t be loaded.</p>}
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{r.actor ? who[r.actor] ?? "A user" : <span className="text-muted">Platform</span>}</td>
                <td>
                  <i className={`ph ${AREA_ICON[r.table_name] ?? "ph-circle"}`} aria-hidden="true" /> {TABLES[r.table_name] ?? r.table_name}
                  <div className="text-muted" style={{ fontSize: 11 }}>{r.action === "insert" ? "added" : r.action === "delete" ? "removed" : "changed"}{isTest(r) ? " · permission test" : ""}</div>
                </td>
                <td style={{ fontSize: 12.5, maxWidth: 560, wordBreak: "break-word" }}>{summarise(r.table_name, r.action, r.changes)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No changes match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: 12, fontSize: 13, alignItems: "center" }}>
          {page > 1 && <Link href={`${params({})}${params({}).includes("?") ? "&" : "?"}page=${page - 1}`}>← Newer</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link href={`${params({})}${params({}).includes("?") ? "&" : "?"}page=${page + 1}`}>Older →</Link>}
        </div>
      )}
    </div>
  );
}
