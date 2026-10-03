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

export function ProjectAdminsTable({ admins }: { admins: Admin[] }) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Programme Administrators</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            The administrators who run each programme on the platform — the Katsina RUTF Pilot today, more states as it scales.
            Super Admin only.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-secondary" href="/data-sets">
            <i className="ph ph-database" /> Add Data Set
          </Link>
          <button className="btn btn-secondary" onClick={() => setModal("bulkImport")}>
            <i className="ph ph-upload-simple" /> Bulk Import
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>
            <i className="ph ph-user-plus" /> Create Project Admin
          </button>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Project</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Last Login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="text-muted">{p.project?.name ?? "—"}</td>
                <td className="text-muted">{p.email}</td>
                <td className="text-muted">{p.phone || "—"}</td>
                <td>
                  <ActiveStatusTag status={p.status === "active" ? "active" : "inactive"} />
                </td>
                <td className="text-muted">{p.last_login ? new Date(p.last_login).toLocaleString() : "—"}</td>
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
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
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
