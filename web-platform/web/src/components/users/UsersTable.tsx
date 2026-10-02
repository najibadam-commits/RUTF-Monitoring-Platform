"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ActiveStatusTag } from "@/components/ui/Tags";
import { BulkImportUsersModal } from "./BulkImportUsersModal";
import { ASSIGNABLE_ROLES_BY_PROJECT_ADMIN, ASSIGNABLE_ROLES_BY_SUPER_ADMIN, ROLE_LABELS, assignableRolesFor, roleOptionLabel } from "@/lib/rbac";
import type { Database, UserRole } from "@/lib/types/database";
import { addUserAction, editUserAction, removeUserAction, resetUserPasswordAction } from "@/lib/actions/users";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ModalKind = "add" | "edit" | "remove" | "reset" | "bulkImport" | null;

export function UsersTable({
  users,
  callerRole,
  callerId,
  states,
  sectors,
}: {
  users: Profile[];
  callerRole: UserRole;
  callerId: string;
  states: { id: string; name: string }[];
  /** Active sectors only — see getCategories' kdoc. */
  sectors: { id: string; name: string }[];
}) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [target, setTarget] = useState<Profile | null>(null);
  const [removeMode, setRemoveMode] = useState<"deactivate" | "delete">("deactivate");
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: assignableRolesFor(callerRole)[0] ?? "viewer",
    managedStateId: "",
    assignedCategoryId: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "viewer" as UserRole,
    status: "active" as "active" | "inactive",
    managedStateId: "",
    assignedCategoryId: "",
  });
  const [resetState, setResetState] = useState<{ id: string; status: "pending" | "success" | "error"; message?: string } | null>(null);

  async function handleResetPassword(u: Profile) {
    setResetState({ id: u.id, status: "pending" });
    const result = await resetUserPasswordAction(u.email);
    setResetState({ id: u.id, status: result.error ? "error" : "success", message: result.error ?? "Password reset email sent." });
  }

  const assignable = assignableRolesFor(callerRole);
  const allRoleOptions = callerRole === "super_admin" ? ASSIGNABLE_ROLES_BY_SUPER_ADMIN : ASSIGNABLE_ROLES_BY_PROJECT_ADMIN;

  function canManage(u: Profile) {
    if (callerRole === "super_admin") return u.id !== callerId;
    if (callerRole === "project_admin") return u.role !== "super_admin" && u.role !== "project_admin";
    return false;
  }

  function openEdit(u: Profile) {
    setTarget(u);
    setEditForm({
      name: u.name,
      email: u.email,
      phone: u.phone ?? "",
      role: u.role,
      status: u.status,
      managedStateId: u.managed_state_id ?? "",
      assignedCategoryId: u.assigned_category_id ?? "",
    });
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setAddForm({ name: "", email: "", phone: "", role: assignable[0] ?? "viewer", managedStateId: "", assignedCategoryId: "" });
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Users &amp; Role Management</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {users.length} account{users.length === 1 ? "" : "s"}
            {callerRole === "project_admin" ? " in your project." : " across the platform."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setModal("bulkImport")}>
            <i className="ph ph-upload-simple" /> Bulk Import
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>
            <i className="ph ph-user-plus" /> Add User
          </button>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="text-muted">{u.email}</td>
                <td className="text-muted">{u.phone || "—"}</td>
                <td>
                  <span className="tag tag-accent">{ROLE_LABELS[u.role]}</span>
                </td>
                <td>
                  <ActiveStatusTag status={u.status === "active" ? "active" : "inactive"} />
                </td>
                <td className="text-muted">{u.last_login ? new Date(u.last_login).toLocaleString() : "—"}</td>
                <td className="table-actions">
                  {canManage(u) && (
                    <>
                      {resetState?.id === u.id && resetState.status !== "pending" && (
                        <span
                          className="text-muted"
                          style={{ fontSize: 11, color: resetState.status === "error" ? "var(--priority-critical)" : "var(--status-resolved)" }}
                        >
                          {resetState.message}
                        </span>
                      )}
                      <button className="btn btn-icon btn-ghost" title="Edit user" onClick={() => openEdit(u)}>
                        <i className="ph ph-pencil-simple" />
                      </button>
                      <button
                        className="btn btn-icon btn-ghost"
                        title="Reset password"
                        disabled={resetState?.id === u.id && resetState.status === "pending"}
                        onClick={() => handleResetPassword(u)}
                      >
                        <i className={resetState?.id === u.id && resetState.status === "pending" ? "ph ph-circle-notch spin" : "ph ph-key"} />
                      </button>
                      <button
                        className="btn btn-icon btn-ghost"
                        title="Remove user"
                        onClick={() => {
                          setTarget(u);
                          setRemoveMode("deactivate");
                          setModal("remove");
                        }}
                      >
                        <i className="ph ph-user-minus" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "add" && (
        <Modal
          title="Add User"
          confirmLabel="Add User"
          onClose={closeModal}
          onConfirm={() =>
            addUserAction({
              ...addForm,
              managedStateId: addForm.role === "state_coordinator" ? addForm.managedStateId : null,
              assignedCategoryId: addForm.role === "dri" ? addForm.assignedCategoryId : null,
            })
          }
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Full Name</label>
              <input className="input" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field">
              <label>Phone Number</label>
              <input className="input" type="tel" placeholder="+234…" value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="field">
              <label>Role</label>
              <select className="input" value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {roleOptionLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            {addForm.role === "state_coordinator" && (
              <div className="field">
                <label>Managed State</label>
                <select className="input" value={addForm.managedStateId} onChange={(e) => setAddForm((f) => ({ ...f, managedStateId: e.target.value }))}>
                  <option value="">Select a State…</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {addForm.role === "dri" && (
              <div className="field">
                <label>Assigned Sector</label>
                <select className="input" value={addForm.assignedCategoryId} onChange={(e) => setAddForm((f) => ({ ...f, assignedCategoryId: e.target.value }))}>
                  <option value="">Select a Sector…</option>
                  {sectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  This DRI will only see Findings in this sector.
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {modal === "edit" && target && (
        <Modal
          title="Edit User"
          onClose={closeModal}
          onConfirm={() =>
            editUserAction({
              userId: target.id,
              ...editForm,
              managedStateId: editForm.role === "state_coordinator" ? editForm.managedStateId : null,
              assignedCategoryId: editForm.role === "dri" ? editForm.assignedCategoryId : null,
            })
          }
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Full Name</label>
              <input className="input" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field">
              <label>Phone Number</label>
              <input className="input" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="field">
              <label>Role</label>
              <select className="input" value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
                {allRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleOptionLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            {editForm.role === "state_coordinator" && (
              <div className="field">
                <label>Managed State</label>
                <select className="input" value={editForm.managedStateId} onChange={(e) => setEditForm((f) => ({ ...f, managedStateId: e.target.value }))}>
                  <option value="">Select a State…</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {editForm.role === "dri" && (
              <div className="field">
                <label>Assigned Sector</label>
                <select className="input" value={editForm.assignedCategoryId} onChange={(e) => setEditForm((f) => ({ ...f, assignedCategoryId: e.target.value }))}>
                  <option value="">Select a Sector…</option>
                  {sectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  This DRI will only see Findings in this sector.
                </div>
              </div>
            )}
            <div className="field">
              <label>Status</label>
              <div className="seg">
                <label className="seg-opt">
                  <input type="radio" checked={editForm.status === "active"} onChange={() => setEditForm((f) => ({ ...f, status: "active" }))} />
                  Active
                </label>
                <label className="seg-opt">
                  <input type="radio" checked={editForm.status === "inactive"} onChange={() => setEditForm((f) => ({ ...f, status: "inactive" }))} />
                  Inactive
                </label>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal === "remove" && target && (
        <Modal
          title="Remove User"
          confirmLabel={removeMode === "delete" ? "Permanently Remove" : "Deactivate"}
          onClose={closeModal}
          onConfirm={() => removeUserAction(target.id, removeMode)}
        >
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              You are about to remove <strong>{target.name}</strong>. This cannot be undone if permanently deleted.
            </p>
            <div className="field">
              <label>Action</label>
              <div className="seg">
                <label className="seg-opt">
                  <input type="radio" checked={removeMode === "deactivate"} onChange={() => setRemoveMode("deactivate")} />
                  Deactivate
                </label>
                {callerRole === "super_admin" && (
                  <label className="seg-opt">
                    <input type="radio" checked={removeMode === "delete"} onChange={() => setRemoveMode("delete")} />
                    Permanently Remove
                  </label>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal === "bulkImport" && <BulkImportUsersModal users={users} callerRole={callerRole} onClose={closeModal} />}
    </div>
  );
}
