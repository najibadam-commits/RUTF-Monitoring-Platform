"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { CsvUploadModal } from "./CsvUploadModal";
import { tagBg } from "@/lib/constants";
import type { Database } from "@/lib/types/database";
import {
  addActivitySiteAction,
  addSettlementAction,
  approveActivitySiteAction,
  approveSettlementAction,
  deleteActivitySiteAction,
  deleteSettlementAction,
  rejectActivitySiteAction,
  rejectSettlementAction,
  updateActivitySiteAction,
  updateSettlementAction,
} from "@/lib/actions/datasets";

type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
type ActivitySite = Database["public"]["Tables"]["activity_sites"]["Row"];
type Tab = "settlements" | "activitySites";
type NamedRef = { id: string; name: string };
type Filters = { search: string; status: string; state: string; lga: string };

const STATUS_META: Record<string, { label: string; color: string }> = {
  approved: { label: "Approved", color: "var(--status-resolved)" },
  pending_create: { label: "Pending — New", color: "var(--priority-high)" },
  pending_update: { label: "Pending — Edit", color: "var(--priority-high)" },
  pending_delete: { label: "Pending — Delete", color: "var(--priority-critical)" },
  rejected: { label: "Rejected", color: "var(--color-neutral-500)" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending Review" },
  { value: "rejected", label: "Rejected" },
];

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "var(--color-neutral-500)" };
  return (
    <span className="tag" style={{ background: tagBg(meta.color), color: meta.color }}>
      {meta.label}
    </span>
  );
}

/** State -> LGA -> Ward cascade, always resolving to a ward_id — the only thing Settlements/Activity Sites actually store. */
function LocationFields({
  states,
  lgasByState,
  wardsByLga,
  stateId,
  lgaId,
  wardId,
  onChange,
}: {
  states: NamedRef[];
  lgasByState: Record<string, NamedRef[]>;
  wardsByLga: Record<string, NamedRef[]>;
  stateId: string;
  lgaId: string;
  wardId: string;
  onChange: (patch: { stateId?: string; lgaId?: string; wardId?: string }) => void;
}) {
  return (
    <>
      <div className="field">
        <label>State</label>
        <select className="input" value={stateId} onChange={(e) => onChange({ stateId: e.target.value, lgaId: "", wardId: "" })}>
          <option value="">Select a state…</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>LGA</label>
        <select className="input" value={lgaId} onChange={(e) => onChange({ lgaId: e.target.value, wardId: "" })} disabled={!stateId}>
          <option value="">Select an LGA…</option>
          {(lgasByState[stateId] ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Ward</label>
        <select className="input" value={wardId} onChange={(e) => onChange({ wardId: e.target.value })} disabled={!lgaId}>
          <option value="">Select a ward…</option>
          {(wardsByLga[lgaId] ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function DataSetsClient({
  tab,
  rows,
  total,
  page,
  totalPages,
  pendingCount,
  filters,
  states,
  lgasByState,
  wardsByLga,
  isSuperAdmin,
  currentUserId,
}: {
  tab: Tab;
  rows: (Settlement | ActivitySite)[];
  total: number;
  page: number;
  totalPages: number;
  pendingCount: number;
  filters: Filters;
  states: NamedRef[];
  lgasByState: Record<string, NamedRef[]>;
  wardsByLga: Record<string, NamedRef[]>;
  isSuperAdmin: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [modal, setModal] = useState<"add" | "edit" | "delete" | "approve" | "reject" | "csv" | null>(null);
  const [target, setTarget] = useState<Settlement | ActivitySite | null>(null);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ stateId: "", lgaId: "", wardId: "", name: "" });

  // Reverse lookups (ward_id -> lga_id -> state_id) so editing a row can
  // preselect the cascade from just the ward_id it already has.
  const lgaToState = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [stateId, lgas] of Object.entries(lgasByState)) for (const l of lgas) m[l.id] = stateId;
    return m;
  }, [lgasByState]);
  const wardToLga = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [lgaId, wards] of Object.entries(wardsByLga)) for (const w of wards) m[w.id] = lgaId;
    return m;
  }, [wardsByLga]);

  // statename/lganame on settlements/activity_sites are plain text, not FKs (DECISIONS.md #6a)
  // — filter values in the URL are names. This maps the current filter's state *name* back to
  // an id purely to know which LGA options to show in the cascade below.
  const nameToStateId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of states) m[s.name] = s.id;
    return m;
  }, [states]);
  const filterStateId = nameToStateId[filters.state] ?? "";

  function pendingNameOf(row: Settlement | ActivitySite) {
    const pd = row.pending_data as Record<string, string> | null;
    if (!pd) return null;
    return tab === "settlements" ? pd.settlementname : pd.activitysitename;
  }
  function nameOf(row: Settlement | ActivitySite) {
    return tab === "settlements" ? (row as Settlement).settlementname : (row as ActivitySite).activitysitename;
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setNote("");
    setForm({ stateId: "", lgaId: "", wardId: "", name: "" });
  }

  function openAdd() {
    setForm({ stateId: "", lgaId: "", wardId: "", name: "" });
    setModal("add");
  }
  function openEdit(row: Settlement | ActivitySite) {
    const lgaId = wardToLga[row.ward_id] ?? "";
    const stateId = lgaId ? (lgaToState[lgaId] ?? "") : "";
    setTarget(row);
    setForm({ stateId, lgaId, wardId: row.ward_id, name: nameOf(row) });
    setModal("edit");
  }

  async function submitAdd() {
    if (tab === "settlements") return addSettlementAction({ wardId: form.wardId, settlementname: form.name });
    return addActivitySiteAction({ wardId: form.wardId, activitysitename: form.name });
  }
  async function submitEdit() {
    if (!target) return { error: "No entry selected." };
    if (tab === "settlements") return updateSettlementAction(target.id, { wardId: form.wardId, settlementname: form.name });
    return updateActivitySiteAction(target.id, { wardId: form.wardId, activitysitename: form.name });
  }
  async function submitDelete() {
    if (!target) return { error: "No entry selected." };
    return tab === "settlements" ? deleteSettlementAction(target.id) : deleteActivitySiteAction(target.id);
  }
  async function submitApprove() {
    if (!target) return { error: "No entry selected." };
    return tab === "settlements" ? approveSettlementAction(target.id, note) : approveActivitySiteAction(target.id, note);
  }
  async function submitReject() {
    if (!target) return { error: "No entry selected." };
    return tab === "settlements" ? rejectSettlementAction(target.id, note) : rejectActivitySiteAction(target.id, note);
  }

  // Builds /data-sets?... preserving every current param except the ones being overridden —
  // shared by the tab switch, every filter control, and pagination links below.
  function hrefWith(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return `/data-sets?${params.toString()}`;
  }

  const hasActiveFilters = filters.search || filters.status || filters.state || filters.lga;
  // Keys the uncontrolled search input so it properly remounts (re-applying its defaultValue)
  // whenever filters change via something other than typing in it — e.g. Clear Filters, tab
  // switch, or browser back/forward.
  const remountKey = searchParams.toString();

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Data Sets</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Manage Settlement Lists and Activity Sites synced to the field mobile app.
            {isSuperAdmin && pendingCount > 0 && ` ${pendingCount} entr${pendingCount === 1 ? "y needs" : "ies need"} your review.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setModal("csv")}>
            <i className="ph ph-upload-simple" /> Upload CSV
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <i className="ph ph-plus" /> Add Manually
          </button>
        </div>
      </div>

      <div className="seg" style={{ width: "fit-content" }}>
        <label className="seg-opt">
          <input type="radio" checked={tab === "settlements"} onChange={() => router.push(hrefWith({ tab: null, page: null }))} />
          Settlement Lists
        </label>
        <label className="seg-opt">
          <input type="radio" checked={tab === "activitySites"} onChange={() => router.push(hrefWith({ tab: "activitySites", page: null }))} />
          Activity Sites
        </label>
      </div>

      <div className="filter-bar" key={remountKey}>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Search name, state, LGA…"
          defaultValue={filters.search}
          onChange={(e) => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
            const value = e.target.value;
            searchTimer.current = setTimeout(() => router.push(hrefWith({ search: value || null, page: null })), 350);
          }}
        />
        <select
          className="input"
          style={{ maxWidth: 170 }}
          defaultValue={filters.status || "All"}
          onChange={(e) => router.push(hrefWith({ status: e.target.value === "All" ? null : e.target.value, page: null }))}
        >
          <option value="All">All Status</option>
          {STATUS_FILTER_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ maxWidth: 170 }}
          defaultValue={filters.state || "All"}
          onChange={(e) => {
            const name = e.target.value === "All" ? null : e.target.value;
            router.push(hrefWith({ state: name, lga: null, page: null }));
          }}
        >
          <option value="All">All States</option>
          {states.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ maxWidth: 190 }}
          defaultValue={filters.lga || "All"}
          disabled={!filterStateId}
          onChange={(e) => router.push(hrefWith({ lga: e.target.value === "All" ? null : e.target.value, page: null }))}
        >
          <option value="All">All LGAs</option>
          {(lgasByState[filterStateId] ?? []).map((l) => (
            <option key={l.id} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => router.push(hrefWith({ tab, page: null, search: null, status: null, state: null, lga: null }))}>
            <i className="ph ph-x-circle" />
            Clear Filters
          </button>
        )}
      </div>

      <div className="card elev-sm" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>State</th>
              <th>LGA</th>
              <th>{tab === "settlements" ? "Settlement" : "Activity Site"}</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pendingName = pendingNameOf(row);
              const canReview = isSuperAdmin && row.status.startsWith("pending_");
              const isOwnPending = row.submitted_by === currentUserId && row.status.startsWith("pending_");
              return (
                <tr key={row.id}>
                  <td>{row.statename}</td>
                  <td>{row.lganame}</td>
                  <td>
                    {nameOf(row)}
                    {row.status === "pending_update" && pendingName && (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        proposed: {pendingName}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                    {row.status === "rejected" && row.review_note && (
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {row.review_note}
                      </div>
                    )}
                  </td>
                  <td className="table-actions">
                    {canReview && (
                      <>
                        <button
                          className="btn btn-icon btn-ghost"
                          title="Approve"
                          onClick={() => {
                            setTarget(row);
                            setModal("approve");
                          }}
                        >
                          <i className="ph ph-check-circle" style={{ color: "var(--status-resolved)" }} />
                        </button>
                        <button
                          className="btn btn-icon btn-ghost"
                          title="Reject"
                          onClick={() => {
                            setTarget(row);
                            setModal("reject");
                          }}
                        >
                          <i className="ph ph-x-circle" style={{ color: "var(--priority-critical)" }} />
                        </button>
                      </>
                    )}
                    {(isSuperAdmin || row.status === "approved" || isOwnPending) && (
                      <>
                        <button className="btn btn-icon btn-ghost" title="Edit" onClick={() => openEdit(row)}>
                          <i className="ph ph-pencil-simple" />
                        </button>
                        <button
                          className="btn btn-icon btn-ghost"
                          title="Delete"
                          onClick={() => {
                            setTarget(row);
                            setModal("delete");
                          }}
                        >
                          <i className="ph ph-trash" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  {total === 0 ? "No entries yet." : "No entries match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--color-divider)" }}>
          <span className="text-muted" style={{ fontSize: 12.5 }}>
            {total} matching entr{total === 1 ? "y" : "ies"} — page {page} of {totalPages}
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

      {(modal === "add" || modal === "edit") && (
        <Modal
          title={modal === "add" ? "Add Data Set Entry" : "Edit Entry"}
          confirmLabel={modal === "add" ? "Add" : "Save"}
          confirmDisabled={!form.wardId || !form.name.trim()}
          onClose={closeModal}
          onConfirm={modal === "add" ? submitAdd : submitEdit}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!isSuperAdmin && (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                This will be submitted for Super Admin approval before it&apos;s published.
              </p>
            )}
            <LocationFields
              states={states}
              lgasByState={lgasByState}
              wardsByLga={wardsByLga}
              stateId={form.stateId}
              lgaId={form.lgaId}
              wardId={form.wardId}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
            <div className="field">
              <label>{tab === "settlements" ? "Settlement Name" : "Activity Site Name"}</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "delete" && target && (
        <Modal title="Delete Entry" confirmLabel="Delete" onClose={closeModal} onConfirm={submitDelete}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Remove <strong>{nameOf(target)}</strong>?{" "}
              {!isSuperAdmin && target.status === "approved" && "This will be submitted for Super Admin approval."}
            </p>
          </div>
        </Modal>
      )}

      {modal === "approve" && target && (
        <Modal title="Approve Entry" confirmLabel="Approve" onClose={closeModal} onConfirm={submitApprove}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Approve this {STATUS_META[target.status]?.label.toLowerCase()} for <strong>{nameOf(target)}</strong>?
            </p>
            <div className="field">
              <label>Note (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "reject" && target && (
        <Modal title="Reject Entry" confirmLabel="Reject" onClose={closeModal} onConfirm={submitReject}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Reject this change for <strong>{nameOf(target)}</strong>? The submitter will see your note.
            </p>
            <div className="field">
              <label>Reason</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "csv" && (
        <CsvUploadModal kind={tab} states={states} lgasByState={lgasByState} wardsByLga={wardsByLga} onClose={closeModal} />
      )}
    </div>
  );
}
