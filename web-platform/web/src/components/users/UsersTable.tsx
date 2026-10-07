"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ActiveStatusTag } from "@/components/ui/Tags";
import { BulkImportUsersModal } from "./BulkImportUsersModal";
import { FacilityPicker, type FacilityOption } from "./FacilityPicker";
import { SupervisorScopePicker, type SupervisionLevel } from "./SupervisorScopePicker";
import { ASSIGNABLE_ROLES_BY_PROJECT_ADMIN, ASSIGNABLE_ROLES_BY_SUPER_ADMIN, ROLE_LABELS, assignableRolesFor, roleOptionLabel } from "@/lib/rbac";
import type { Database, UserRole } from "@/lib/types/database";
import { addUserAction, editUserAction, removeUserAction, resetUserPasswordAction } from "@/lib/actions/users";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ModalKind = "add" | "edit" | "remove" | "reset" | "bulkImport" | null;

// Users & Access (DECISIONS R94): who can do what, at a glance — one card per role with what it can
// do and how many active accounts hold it (click to filter), a search and status filter, each
// account's area (facility, supervised LGAs, state or the whole platform) and when it was last active.
const ROLE_ORDER: UserRole[] = ["super_admin", "project_admin", "state_coordinator", "tpm_supervisor", "dri", "viewer"];
const ROLE_CAN: Record<UserRole, { icon: string; can: string }> = {
  super_admin: { icon: "ph-crown", can: "Everything: users, settings, master data, void ledger entries, approve data requests" },
  project_admin: { icon: "ph-identification-badge", can: "Runs the pilot: users, master data, voids, data requests and the audit trail" },
  state_coordinator: { icon: "ph-user-check", can: "Reviews new Findings: approves them for action or returns them for correction" },
  tpm_supervisor: { icon: "ph-clipboard-text", can: "Store checks and OTP verifications in their LGAs; verifies and closes Findings" },
  dri: { icon: "ph-first-aid-kit", can: "Records stock and dispensing at their store or OTP site; responds to Findings" },
  viewer: { icon: "ph-eye", can: "Read-only dashboards and reports; data downloads only by approved request" },
};

/** The "signed in during the last 30 days" figure appears from this many accounts (DECISIONS R99). */
const MIN_ACTIVE_TO_SHOW = 5;

function lastActive(iso: string | null, now: number) {
  if (!iso) return "Never signed in";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function UsersTable({
  users,
  callerRole,
  callerId,
  states,
  facilities,
  facilityNames,
  lgas,
  supervisedLgas,
}: {
  users: Profile[];
  callerRole: UserRole;
  callerId: string;
  states: { id: string; name: string }[];
  /** Assignable facilities (stores + OTP sites) for the facility-user picker. */
  facilities: FacilityOption[];
  /** Names of every facility a listed user is assigned to (may include ones not assignable now). */
  facilityNames: Record<string, string>;
  lgas: { id: string; name: string }[];
  /** profile id -> the LGAs a supervisor covers (migration 0103). */
  supervisedLgas: Record<string, string[]>;
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
    facilityId: "",
    supervisionLevel: "" as SupervisionLevel | "",
    supervisedLgaIds: [] as string[],
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "viewer" as UserRole,
    status: "active" as "active" | "inactive",
    managedStateId: "",
    facilityId: "",
    supervisionLevel: "" as SupervisionLevel | "",
    supervisedLgaIds: [] as string[],
  });
  const [resetState, setResetState] = useState<{ id: string; status: "pending" | "success" | "error"; message?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [now] = useState(() => Date.now());

  const roleCounts = Object.fromEntries(ROLE_ORDER.map((r) => [r, users.filter((u) => u.role === r && u.status === "active").length])) as Record<UserRole, number>;
  const q = query.trim().toLowerCase();
  const shown = users.filter(
    (u) =>
      (roleFilter === "all" || u.role === roleFilter) &&
      (statusFilter === "all" || u.status === statusFilter) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone ?? "").includes(q)),
  );
  const activeRecently = users.filter((u) => u.status === "active" && u.last_login && now - Date.parse(u.last_login) < 30 * 86_400_000).length;
  const activeCount = users.filter((u) => u.status === "active").length;

  // Coverage (DECISIONS R121): every store and OTP site needs an active facility user, and every LGA
  // a supervisor for its stores and one for its OTP sites.
  const activeUsers = users.filter((u) => u.status === "active");
  const staffed = new Set(activeUsers.filter((u) => u.role === "dri" && u.facility_id).map((u) => u.facility_id!));
  const unstaffed = facilities.filter((f) => !staffed.has(f.id));
  const covered = (level: "stores" | "otp_sites") => {
    const set = new Set<string>();
    for (const u of activeUsers) if (u.role === "tpm_supervisor" && u.supervision_level === level) for (const l of supervisedLgas[u.id] ?? []) set.add(l);
    return set;
  };
  const storeCovered = covered("stores");
  const otpCovered = covered("otp_sites");
  const lgasWith = (pred: (f: FacilityOption) => boolean) => new Set(facilities.filter(pred).map((f) => f.lga_id));
  const storeLgas = lgasWith((f) => f.facility_type !== "health_facility");
  const otpLgas = lgasWith((f) => f.facility_type === "health_facility");
  const storeGaps = [...storeLgas].filter((l) => !storeCovered.has(l));
  const otpGaps = [...otpLgas].filter((l) => !otpCovered.has(l));
  const lgaLabel = (id: string) => lgas.find((l) => l.id === id)?.name ?? "an LGA";

  /** Where an account works: its facility, supervised LGAs, managed state, or the whole platform. */
  function areaOf(u: Profile) {
    if (u.role === "dri") return u.facility_id ? (facilityNames[u.facility_id] ?? "Facility") : "No facility assigned";
    if (u.role === "tpm_supervisor") {
      if (!u.supervision_level) return "No supervision area set";
      const ids = supervisedLgas[u.id] ?? [];
      const where = ids.length === 1 ? (lgas.find((l) => l.id === ids[0])?.name ?? "1 LGA") : `${ids.length} LGAs`;
      return `${u.supervision_level === "stores" ? "Stores" : "OTP sites"} · ${where}`;
    }
    if (u.role === "super_admin") return "Whole platform";
    if (u.managed_state_id) return states.find((s) => s.id === u.managed_state_id)?.name ?? "Their state";
    return u.role === "viewer" ? "Dashboards, read-only" : "Their project";
  }

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
      facilityId: u.facility_id ?? "",
      supervisionLevel: u.supervision_level ?? "",
      supervisedLgaIds: supervisedLgas[u.id] ?? [],
    });
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setAddForm({ name: "", email: "", phone: "", role: assignable[0] ?? "viewer", managedStateId: "", facilityId: "", supervisionLevel: "", supervisedLgaIds: [] });
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Users &amp; Access</h2>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 820 }}>
            {activeCount} active account{activeCount === 1 ? "" : "s"}
            {callerRole === "project_admin" ? " in your project" : " across the platform"}
            {/* Shown once there is real use (DECISIONS R99): with only demo accounts it would read as "nobody uses it". */}
            {activeRecently >= MIN_ACTIVE_TO_SHOW ? `, ${activeRecently} signed in during the last 30 days. ` : ". "}
            Each role sees and changes only its own area; the database enforces it for the web, the app and the API alike, and every
            change to an account is in the Audit Trail.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setModal("bulkImport")}>
            <i className="ph ph-upload-simple" /> Bulk import
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>
            <i className="ph ph-user-plus" /> Add user
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
        {ROLE_ORDER.filter((r) => roleCounts[r] > 0 || r !== "state_coordinator").map((r) => {
          const active = roleFilter === r;
          return (
            <button key={r} type="button" className="card elev-sm" aria-pressed={active} onClick={() => setRoleFilter(active ? "all" : r)}
              title={active ? "Show every role" : `Show only ${ROLE_LABELS[r]} accounts`}
              style={{ padding: 12, gap: 4, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", outline: active ? "2px solid var(--color-accent-600)" : undefined, outlineOffset: -2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className={`ph-fill ${ROLE_CAN[r].icon}`} aria-hidden="true" style={{ color: "var(--color-accent-600)", fontSize: 16 }} />
                <strong style={{ fontSize: 13.5, flex: 1 }}>{r === "dri" ? "Facility user (DRI)" : ROLE_LABELS[r]}</strong>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700 }}>{roleCounts[r]}</span>
              </span>
              <span className="text-muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{ROLE_CAN[r].can}</span>
            </button>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: "12px 14px", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="card-title" style={{ fontSize: 14 }}>Coverage</div>
          <span className="kpi-sub">Every facility has someone recording for it, and every LGA someone checking it.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
          {[
            { label: "Stores and OTP sites with a facility user", done: facilities.length - unstaffed.length, of: facilities.length,
              gap: unstaffed.length ? `${unstaffed.slice(0, 3).map((f) => f.name).join(", ")}${unstaffed.length > 3 ? ` and ${unstaffed.length - 3} more` : ""} have none` : "All staffed" },
            { label: "LGAs with a stores supervisor", done: storeLgas.size - storeGaps.length, of: storeLgas.size,
              gap: storeGaps.length ? `${storeGaps.slice(0, 3).map(lgaLabel).join(", ")}${storeGaps.length > 3 ? ` and ${storeGaps.length - 3} more` : ""} have none` : "All covered" },
            { label: "LGAs with an OTP-sites supervisor", done: otpLgas.size - otpGaps.length, of: otpLgas.size,
              gap: otpGaps.length ? `${otpGaps.slice(0, 3).map(lgaLabel).join(", ")}${otpGaps.length > 3 ? ` and ${otpGaps.length - 3} more` : ""} have none` : "All covered" },
          ].map((c) => {
            const full = c.of > 0 && c.done === c.of;
            return (
              <div key={c.label} style={{ border: "1px solid var(--color-divider)", borderRadius: 10, padding: "8px 10px" }}>
                <div className="kpi-label">
                  <i className={`ph-fill ${full ? "ph-check-circle" : "ph-warning"}`} aria-hidden="true" style={{ color: full ? "var(--status-resolved)" : "var(--priority-high)" }} /> {c.label}
                </div>
                <div className="kpi-value" style={{ fontSize: 18 }}>
                  {c.done.toLocaleString("en-GB")}<span className="kpi-unit"> / {c.of.toLocaleString("en-GB")}</span>
                </div>
                <div className="kpi-sub" style={{ color: full ? undefined : "var(--priority-high)" }}>{c.gap}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="filter-bar">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search name, email or phone…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        <select className="input" style={{ maxWidth: 190 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")} aria-label="Role">
          <option value="all">All roles</option>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{r === "dri" ? "Facility user (DRI)" : ROLE_LABELS[r]}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">Active and inactive</option>
        </select>
        <span className="text-muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>{shown.length} of {users.length} accounts</span>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Area</th>
              <th>Status</th>
              <th>Last active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                </td>
                <td>
                  <span className="tag tag-accent">{ROLE_LABELS[u.role]}</span>
                </td>
                <td className="text-muted" style={{ fontSize: 12.5, maxWidth: 260 }}>{areaOf(u)}</td>
                <td>
                  <ActiveStatusTag status={u.status === "active" ? "active" : "inactive"} />
                </td>
                <td className="text-muted" style={{ fontSize: 12.5 }} title={u.last_login ? new Date(u.last_login).toLocaleString("en-GB") : undefined}>
                  {lastActive(u.last_login, now)}
                </td>
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
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  {users.length === 0 ? "No users yet." : "No accounts match these filters."}
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
              facilityId: addForm.role === "dri" ? addForm.facilityId : null,
              supervisionLevel: addForm.role === "tpm_supervisor" ? addForm.supervisionLevel || null : null,
              supervisedLgaIds: addForm.role === "tpm_supervisor" ? addForm.supervisedLgaIds : [],
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
              <FacilityPicker value={addForm.facilityId} onChange={(id) => setAddForm((f) => ({ ...f, facilityId: id }))} facilities={facilities} lgas={lgas} />
            )}
            {addForm.role === "tpm_supervisor" && (
              <SupervisorScopePicker
                level={addForm.supervisionLevel}
                lgaIds={addForm.supervisedLgaIds}
                lgas={lgas}
                onChange={(n) => setAddForm((f) => ({ ...f, supervisionLevel: n.level, supervisedLgaIds: n.lgaIds }))}
              />
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
              facilityId: editForm.role === "dri" ? editForm.facilityId : null,
              supervisionLevel: editForm.role === "tpm_supervisor" ? editForm.supervisionLevel || null : null,
              supervisedLgaIds: editForm.role === "tpm_supervisor" ? editForm.supervisedLgaIds : [],
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
              <FacilityPicker value={editForm.facilityId} onChange={(id) => setEditForm((f) => ({ ...f, facilityId: id }))} facilities={facilities} lgas={lgas} />
            )}
            {editForm.role === "tpm_supervisor" && (
              <SupervisorScopePicker
                level={editForm.supervisionLevel}
                lgaIds={editForm.supervisedLgaIds}
                lgas={lgas}
                onChange={(n) => setEditForm((f) => ({ ...f, supervisionLevel: n.level, supervisedLgaIds: n.lgaIds }))}
              />
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

      {modal === "bulkImport" && <BulkImportUsersModal users={users} callerRole={callerRole} facilities={facilities} onClose={closeModal} />}
    </div>
  );
}
