import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessAuditLog } from "@/lib/rbac";
import type { SP } from "@/components/reports/ReportShell";

// Audit Trail (brief §10, migration 0108): who changed reference data, user access, DHIS2 uploads
// and ledger / transfer status, with the old and new values. Ledger entries themselves are
// append-only and carry their recorder; this covers everything around them.

const TABLES: Record<string, string> = {
  facilities: "Facilities",
  product_lots: "Lots",
  protocol_rules: "Dosing rules",
  rutf_thresholds: "Thresholds",
  profiles: "Users",
  supervisor_lgas: "Supervisor LGAs",
  dhis2_reports: "DHIS2 reports",
  stock_transactions: "Ledger entries",
  transfers: "Transfers",
};
const PAGE = 100;

function summarise(action: string, changes: unknown) {
  const c = (changes ?? {}) as Record<string, unknown>;
  if (action !== "update") {
    const name = c.name ?? c.lot_no ?? c.key ?? c.code ?? c.period;
    return `${action === "insert" ? "Added" : "Removed"}${name ? ` ${String(name)}` : ""}`;
  }
  return Object.entries(c)
    .map(([k, v]) => {
      const [o, n] = Array.isArray(v) ? v : [null, v];
      const show = (x: unknown) => (x === null || x === undefined ? "—" : typeof x === "object" ? JSON.stringify(x) : String(x));
      return `${k.replace(/_/g, " ")}: ${show(o)} → ${show(n)}`;
    })
    .join("; ");
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  if (!canAccessAuditLog(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("*", { count: "exact" }).order("at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.table && TABLES[sp.table]) q = q.eq("table_name", sp.table);
  if (sp.row) q = q.eq("row_id", sp.row);
  const { data, count, error } = await q;
  const actors = [...new Set((data ?? []).map((r) => r.actor).filter((a): a is string => !!a))];
  const { data: people } = actors.length ? await supabase.from("profiles").select("id, name").in("id", actors) : { data: [] };
  const who = Object.fromEntries((people ?? []).map((p) => [p.id, p.name]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => `/audit-log?${new URLSearchParams({ ...(sp.table ? { table: sp.table } : {}), ...(sp.row ? { row: sp.row } : {}), page: String(p) })}`;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Audit Trail</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 820 }}>
          Every change to facilities, lots, dosing rules, thresholds, user access, supervisor LGAs and DHIS2 uploads, and
          every status change on ledger entries and transfers — who, when, and the old and new values. Entries can&apos;t be
          edited or removed. &quot;Platform&quot; means an import or the nightly job.
        </p>
      </div>
      <form className="filter-bar" method="get">
        <select className="input" name="table" defaultValue={sp.table ?? ""} aria-label="What changed" style={{ maxWidth: 220 }}>
          <option value="">Everything</option>
          {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
      </form>
      {error && <p style={{ color: "var(--priority-critical)" }}>The audit trail couldn&apos;t be loaded.</p>}
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-GB")}</td>
                <td>{r.actor ? who[r.actor] ?? "A user" : <span className="text-muted">Platform</span>}</td>
                <td>{TABLES[r.table_name] ?? r.table_name}<div className="text-muted" style={{ fontSize: 11 }}>{r.action}</div></td>
                <td style={{ fontSize: 12, maxWidth: 560, wordBreak: "break-word" }}>{summarise(r.action, r.changes)}</td>
              </tr>
            ))}
            {(data ?? []).length === 0 && <tr><td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No changes recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: 12, fontSize: 13, alignItems: "center" }}>
          {page > 1 && <a href={link(page - 1)}>← Newer</a>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <a href={link(page + 1)}>Older →</a>}
        </div>
      )}
    </div>
  );
}
