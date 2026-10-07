"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { ActiveStatusTag } from "@/components/ui/Tags";
import { BulkImportProjectAdminsModal } from "./BulkImportProjectAdminsModal";
import type { Database } from "@/lib/types/database";
import { addProjectAdminAction, removeUserAction, resetUserPasswordAction, toggleUserStatusAction } from "@/lib/actions/users";

type Admin = Database["public"]["Tables"]["profiles"]["Row"] & { project: { name: string } | null };
type ModalKind = "add" | "remove" | "bulkImport" | null;

/** A programme on the platform and its footprint (stores and OTP sites, users, open Findings). */
export type Programme = {
  id: string;
  name: string;
  createdAt: string;
  admins: string[];
  lgas: number;
  sites: number;
  users: number;
  openFindings: number;
  closedPct?: number | null;
  facilityUsers?: number;
  supervisors?: number;
  lastLedger?: string | null;
};

// Bringing another state on: what the platform already supports, step by step (DECISIONS R96).
const SCALE_STEPS = [
  { icon: "ph-user-plus", title: "Create the programme", body: "Add its Project Admin here; the programme is created with them.", href: null },
  { icon: "ph-database", title: "Load the facility registry", body: "Import the state's stores and OTP sites in Master Data, with GPS and supply links.", href: "/data-sets" },
  { icon: "ph-sliders-horizontal", title: "Confirm the thresholds", body: "Variance, short-dispensing and target limits, agreed with the State team.", href: "/data-sets?tab=thresholds" },
  { icon: "ph-users-three", title: "Invite the teams", body: "Bulk-import supervisors and facility users, each scoped to their area.", href: "/users" },
  { icon: "ph-device-mobile", title: "Install the app", body: "Android app on facility and supervisor phones; it works offline and syncs.", href: "/devices" },
];

function lastActive(iso: string | null) {
  if (!iso) return "Never signed in";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ProjectAdminsTable({ admins, programmes = [] }: { admins: Admin[]; programmes?: Programme[] }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [target, setTarget] = useState<Admin | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", projectName: "" });
  const [resetState, setResetState] = useState<{ id: string; status: "pending" | "success" | "error"; message?: string } | null>(null);

  async function handleResetPassword(p: Admin) {
    setResetState({ id: p.id, status: "pending" });
    const result = await resetUserPasswordAction(p.email);
    setResetState({ id: p.id, status: result.error ? "error" : "success", message: result.error ?? "Password reset email sent." });
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setForm({ name: "", email: "", phone: "", projectName: "" });
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Programme Administrators</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 820 }}>
            Each programme on the platform runs separately: its own facilities, users, thresholds and data, managed by its own Project
            Admins, so new states can join without seeing each other&apos;s records. The Katsina RUTF Pilot today; more states as it scales.
            Super Admin only.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setModal("bulkImport")}>
            <i className="ph ph-upload-simple" /> Bulk import
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>
            <i className="ph ph-user-plus" /> Add Project Admin
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {programmes.map((g) => (
          <div key={g.id} className="card elev-sm" style={{ padding: 16, gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 36, height: 36, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--color-accent-100)", color: "var(--color-accent-700)", flex: "none" }}>
                <i className="ph-fill ph-buildings" aria-hidden="true" style={{ fontSize: 18 }} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="card-title" style={{ fontSize: 15 }}>{g.name}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Since {new Date(g.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} ·{" "}
                  {g.admins.length ? g.admins.join(", ") : "No Project Admin yet"}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8 }}>
              {[
                { label: "LGAs", value: g.lgas.toLocaleString("en-GB") },
                { label: "Stores & OTP sites", value: g.sites.toLocaleString("en-GB") },
                { label: "Active users", value: g.users.toLocaleString("en-GB"), sub: g.facilityUsers !== undefined ? `${g.facilityUsers} facility · ${g.supervisors} supervisors` : undefined },
                { label: "Open Findings", value: g.openFindings.toLocaleString("en-GB") },
                { label: "Findings closed", value: g.closedPct === null || g.closedPct === undefined ? "—" : `${g.closedPct}%`, sub: "verified by a supervisor" },
              ].map((x) => (
                <div key={x.label}>
                  <div className="kpi-value" style={{ fontSize: 18 }}>{x.value}</div>
                  <div className="kpi-sub">{x.label}</div>
                  {x.sub && <div className="kpi-sub" style={{ fontSize: 10.5 }}>{x.sub}</div>}
                </div>
              ))}
            </div>
            <div className="kpi-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i className={`ph-fill ${g.lastLedger ? "ph-pulse" : "ph-circle-dashed"}`} aria-hidden="true" style={{ color: g.lastLedger ? "var(--status-resolved)" : "var(--color-neutral-500)" }} />
              {g.lastLedger
                ? <>Live: last ledger entry {new Date(`${g.lastLedger}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</>
                : "No ledger entries yet"}
            </div>
          </div>
        ))}
        <button type="button" className="card elev-sm" onClick={() => setModal("add")}
          style={{ padding: 16, gap: 6, alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer", font: "inherit", color: "inherit", border: "1px dashed var(--color-accent-300)", background: "transparent", minHeight: 120 }}>
          <i className="ph ph-plus-circle" aria-hidden="true" style={{ fontSize: 26, color: "var(--color-accent-600)" }} />
          <strong style={{ fontSize: 14 }}>Add a programme</strong>
          <span className="text-muted" style={{ fontSize: 12 }}>Another state or a new phase, with its own Project Admin</span>
        </button>
      </div>

      <div className="card elev-sm" style={{ gap: 10 }}>
        <div>
          <div className="card-title">Bringing another state on</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Five steps, all done on the platform; no new software.</div>
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {SCALE_STEPS.map((st, i) => {
            const inner = (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
                  <i className={`ph-fill ${st.icon}`} aria-hidden="true" style={{ color: "var(--color-accent-600)", fontSize: 16 }} /> {i + 1}. {st.title}
                </span>
                <span className="text-muted" style={{ fontSize: 12 }}>{st.body}</span>
              </>
            );
            return (
              <li key={st.title} style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: 10 }}>
                {st.href ? (
                  <Link href={st.href} style={{ display: "flex", flexDirection: "column", gap: 4, textDecoration: "none", color: "inherit" }}>{inner}</Link>
                ) : (
                  <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>{inner}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <div className="card-title" style={{ padding: "14px 16px 0" }}>Project Admins</div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Programme</th>
              <th>Status</th>
              <th>Last active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name}
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{p.email}{p.phone ? ` · ${p.phone}` : ""}</div>
                </td>
                <td className="text-muted">{p.project?.name ?? "—"}</td>
                <td>
                  <ActiveStatusTag status={p.status === "active" ? "active" : "inactive"} />
                </td>
                <td className="text-muted" style={{ fontSize: 12.5 }}>{lastActive(p.last_login)}</td>
                <td className="table-actions">
                  {resetState?.id === p.id && resetState.status !== "pending" && (
                    <span
                      className="text-muted"
                      style={{ fontSize: 11, color: resetState.status === "error" ? "var(--priority-critical)" : "var(--status-resolved)" }}
                    >
                      {resetState.message}
                    </span>
                  )}
                  <button
                    className="btn btn-icon btn-ghost"
                    title="Reset password"
                    disabled={resetState?.id === p.id && resetState.status === "pending"}
                    onClick={() => handleResetPassword(p)}
                  >
                    <i className={resetState?.id === p.id && resetState.status === "pending" ? "ph ph-circle-notch spin" : "ph ph-key"} />
                  </button>
                  <button className="btn btn-icon btn-ghost" title={p.status === "active" ? "Deactivate" : "Activate"} onClick={() => toggleUserStatusAction(p.id)}>
                    <i className={`ph ${p.status === "active" ? "ph-pause-circle" : "ph-play-circle"}`} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="Remove"
                    onClick={() => {
                      setTarget(p);
                      setModal("remove");
                    }}
                  >
                    <i className="ph ph-trash" />
                  </button>
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No Project Admins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "add" && (
        <Modal title="Create Project Admin" confirmLabel="Create" onClose={closeModal} onConfirm={() => addProjectAdminAction(form)}>
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Project Name</label>
              <input className="input" value={form.projectName} onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))} />
              <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
                This creates a new project record — not a selector for an existing one.
              </p>
            </div>
            <div className="field">
              <label>Full Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field">
              <label>Phone Number</label>
              <input className="input" type="tel" placeholder="+234…" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Role is fixed to Project Admin. Login credentials are set by the admin via the emailed invite link.
            </p>
          </div>
        </Modal>
      )}

      {modal === "bulkImport" && <BulkImportProjectAdminsModal admins={admins} onClose={closeModal} />}

      {modal === "remove" && target && (
        <Modal title="Remove Project Admin" confirmLabel="Remove" onClose={closeModal} onConfirm={() => removeUserAction(target.id, "delete")}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Permanently remove Project Admin <strong>{target.name}</strong>? This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
