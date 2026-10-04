import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessDevices, ROLE_LABELS } from "@/lib/rbac";
import { getProgrammeLgas } from "@/lib/queries/lookups";
import { Flag, SummaryTiles, fmt, type SP } from "@/components/reports/ReportShell";
import type { Database } from "@/lib/types/database";

export const metadata: Metadata = { title: "Offline Sync Health" };

// Offline Sync Health (brief M6, sync-failure monitoring): every facility user and supervisor with the
// latest report from their phone — sync_health() (migration 0108). Each sync run reports what is
// still waiting and why; a morning digest notifies administrators when something is stuck.

type Row = Database["public"]["Functions"]["sync_health"]["Returns"][number];
type Status = Row["status"];

const STATUS: Record<Status, { label: string; level?: "warning" | "critical"; help: string }> = {
  failing: { label: "Failing", level: "critical", help: "A submission keeps failing to sync" },
  stuck: { label: "Waiting > 1 day", level: "warning", help: "Records have waited more than a day" },
  not_syncing: { label: "Not syncing", level: "warning", help: "No sync report for several days" },
  no_report: { label: "Older app", help: "Recording, but the app version doesn't report sync status" },
  never: { label: "Not started", help: "Nothing recorded or synced yet" },
  ok: { label: "OK", help: "Synced, nothing waiting" },
};
const ORDER: Status[] = ["failing", "stuck", "not_syncing", "no_report", "never", "ok"];

function ago(iso: string | null) {
  if (!iso) return "—";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "under an hour ago";
  if (h < 48) return `${Math.floor(h)} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function StatusCell({ s }: { s: Status }) {
  const m = STATUS[s];
  if (m.level) return <Flag level={m.level}>{m.label}</Flag>;
  return (
    <span className={s === "ok" ? undefined : "text-muted"} style={{ whiteSpace: "nowrap" }}>
      <i className={`ph ${s === "ok" ? "ph-check-circle" : "ph-minus-circle"}`} aria-hidden="true" /> {m.label}
    </span>
  );
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await getCurrentProfile();
  if (!canAccessDevices(profile.role)) redirect("/dashboard");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, lgas, { data: failures }] = await Promise.all([
    supabase.rpc("sync_health"),
    getProgrammeLgas(supabase),
    supabase.from("sync_failures").select("*").is("resolved_at", null).order("last_seen_at", { ascending: false }).limit(100),
  ]);
  const lgaName = Object.fromEntries(lgas.map((l) => [l.id, l.name]));
  const all = data ?? [];
  const count = (s: Status) => all.filter((r) => r.status === s).length;
  const status = ORDER.includes(sp.status as Status) ? (sp.status as Status) : null;
  const who = sp.who === "dri" || sp.who === "tpm_supervisor" ? sp.who : null;
  const rows = all
    .filter((r) => (!status || r.status === status) && (!who || r.role === who) && (!sp.lga || r.lga_id === sp.lga))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
  const nameOf = Object.fromEntries(all.map((r) => [r.profile_id, r.name]));
  const href = (s: Status | null) => `/devices?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(who ? { who } : {}), ...(sp.lga ? { lga: sp.lga } : {}) })}`;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 2 }}>Offline Sync Health</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 820 }}>
          The phones facility users and supervisors record on. Each sync reports what is still waiting on the phone;
          a submission that keeps failing, or records waiting more than a day, needs a call to the user. Administrators
          get a morning notification when anything here needs attention.
        </p>
      </div>
      {error && <p style={{ color: "var(--priority-critical)" }}>Sync status couldn&apos;t be loaded.</p>}

      <SummaryTiles items={[
        { label: "Device users", value: fmt(all.length), sub: `${fmt(all.filter((r) => r.role === "dri").length)} facility users, ${fmt(all.filter((r) => r.role === "tpm_supervisor").length)} supervisors` },
        { label: "Failing", value: fmt(count("failing")), sub: STATUS.failing.help },
        { label: "Waiting > 1 day", value: fmt(count("stuck")), sub: STATUS.stuck.help },
        { label: "Not syncing", value: fmt(count("not_syncing")), sub: STATUS.not_syncing.help },
        { label: "OK", value: fmt(count("ok")), sub: `${fmt(count("never"))} not started · ${fmt(count("no_report"))} on an older app` },
      ]} />

      <form className="filter-bar" method="get" style={{ flexWrap: "wrap" }}>
        <select className="input" name="status" defaultValue={status ?? ""} aria-label="Status" style={{ maxWidth: 190 }}>
          <option value="">All statuses</option>
          {ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label} ({count(s)})</option>)}
        </select>
        <select className="input" name="who" defaultValue={who ?? ""} aria-label="Role" style={{ maxWidth: 190 }}>
          <option value="">Facility users and supervisors</option>
          <option value="dri">Facility users</option>
          <option value="tpm_supervisor">Supervisors</option>
        </select>
        <select className="input" name="lga" defaultValue={sp.lga ?? ""} aria-label="LGA" style={{ maxWidth: 170 }}>
          <option value="">All LGAs</option>
          {lgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit"><i className="ph ph-funnel" /> Apply</button>
        {(status || who || sp.lga) && <Link href="/devices" style={{ fontSize: 13 }}>Clear</Link>}
      </form>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>User</th><th>Facility</th><th>Phone</th><th>Last sync</th><th>Last record</th>
              <th style={{ textAlign: "right" }}>Waiting</th><th>Status</th><th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((r) => (
              <tr key={`${r.profile_id}-${r.device_id ?? ""}`}>
                <td>{r.name}<div className="text-muted" style={{ fontSize: 11 }}>{ROLE_LABELS[r.role]}</div></td>
                <td>{r.facility_name ?? <span className="text-muted">—</span>}<div className="text-muted" style={{ fontSize: 11 }}>{r.lga_id ? lgaName[r.lga_id] : ""}</div></td>
                <td className="text-muted" style={{ fontSize: 12 }}>{r.device_model ?? "—"}{r.app_version && <div>App {r.app_version}</div>}</td>
                <td>{ago(r.last_report_at)}</td>
                <td>{ago(r.last_submission_at)}</td>
                <td style={{ textAlign: "right" }}>
                  {r.pending_count + r.failed_count > 0 ? fmt(r.pending_count + r.failed_count) : 0}
                  {r.oldest_pending_at && <div className="text-muted" style={{ fontSize: 11 }}>oldest {ago(r.oldest_pending_at)}</div>}
                </td>
                <td><StatusCell s={r.status} /></td>
                <td style={{ fontSize: 12, maxWidth: 280 }}>{r.last_error ?? <span className="text-muted">—</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-muted" style={{ textAlign: "center", padding: 24 }}>No device users match.</td></tr>}
          </tbody>
        </table>
        {rows.length > 500 && <div className="text-muted" style={{ fontSize: 12, padding: "8px 16px" }}>First 500 of {fmt(rows.length)} — filter to narrow.</div>}
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 16px", fontWeight: 600 }}>
          Submissions not yet through <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>· cleared automatically once they sync</span>
        </div>
        <table className="table">
          <thead><tr><th>User</th><th>Type</th><th>Recorded on phone</th><th style={{ textAlign: "right" }}>Attempts</th><th>Error</th><th>Last tried</th></tr></thead>
          <tbody>
            {(failures ?? []).map((f) => (
              <tr key={f.id}>
                <td>{nameOf[f.profile_id] ?? "—"}</td>
                <td>{f.submission_type?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "—"}</td>
                <td>{f.queued_at ? new Date(f.queued_at).toLocaleString("en-GB") : "—"}</td>
                <td style={{ textAlign: "right" }}>{f.attempts}</td>
                <td style={{ fontSize: 12, maxWidth: 360 }}>{f.error ?? "—"}</td>
                <td>{ago(f.last_seen_at)}</td>
              </tr>
            ))}
            {(failures ?? []).length === 0 && <tr><td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 16 }}>Nothing is failing.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        <Link href={href(null)}>Reset filters</Link> · A phone that is offline keeps its records and sends them with the next sync; nothing is lost while it waits.
      </p>
    </div>
  );
}
