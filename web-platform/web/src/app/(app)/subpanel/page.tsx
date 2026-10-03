import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canAccessSubPanel } from "@/lib/rbac";
import { StatusTag } from "@/components/ui/Tags";
import { ClickableRow } from "@/components/ui/ClickableRow";
import { RealtimeRefresher } from "@/components/realtime/RealtimeRefresher";
import type { IssueStatus } from "@/lib/types/database";

export default async function SubPanelPage() {
  const profile = await getCurrentProfile();
  if (!canAccessSubPanel(profile.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("issues")
    .select("id, code, status, reported_at, category:categories(name), state:states(name), lga:lgas(name), dri:profiles!issues_assigned_dri_fkey(name)")
    .in("status", ["assigned", "in_progress", "resolved"])
    .order("reported_at", { ascending: false });

  const rows = data ?? [];
  const countByStatus = (s: IssueStatus) => rows.filter((r) => r.status === s).length;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <RealtimeRefresher table="issues" />
      <div>
        <h2 style={{ marginBottom: 2 }}>Findings Follow-up</h2>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Approved Findings that are still open: waiting for the responsible person (DRI) to respond, being worked on, or waiting for a supervisor to verify and close.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <div className="card elev-sm">
          <span className="card-kicker">Awaiting DRI Response</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>{countByStatus("assigned")}</div>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">In Progress</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>{countByStatus("in_progress")}</div>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Awaiting Verification</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>{countByStatus("resolved")}</div>
        </div>
      </div>
      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Sector</th>
              <th>Location</th>
              <th>Status</th>
              <th>DRI</th>
              <th>Reported</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <ClickableRow key={i.id} href={`/issues/${i.id}`}>
                <td style={{ fontFamily: "var(--font-heading)" }}>{i.code}</td>
                <td>{(i.category as unknown as { name: string } | null)?.name ?? "—"}</td>
                <td className="text-muted">
                  {(i.state as unknown as { name: string } | null)?.name}, {(i.lga as unknown as { name: string } | null)?.name}
                </td>
                <td>
                  <StatusTag status={i.status as IssueStatus} />
                </td>
                <td className="text-muted">{(i.dri as unknown as { name: string } | null)?.name ?? "Unassigned"}</td>
                <td className="text-muted">{new Date(i.reported_at).toLocaleDateString()}</td>
                <td>
                  <i className="ph ph-caret-right" />
                </td>
              </ClickableRow>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  Nothing awaiting action right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
