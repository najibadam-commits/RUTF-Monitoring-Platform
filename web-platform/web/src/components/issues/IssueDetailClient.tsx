"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, tagBg } from "@/lib/constants";
import { ROLE_LABELS } from "@/lib/rbac";
import type { IssuePriority, IssueStatus, UserRole } from "@/lib/types/database";
import type { IssueWithRelations } from "@/lib/queries/issues";
import { Modal } from "@/components/ui/Modal";
import {
  approveAndAssignFindingAction,
  assignIssueAction,
  deleteIssueSubmissionAction,
  editIssueSubmissionAction,
  recordCorrectiveActionAction,
  returnFindingForCorrectionAction,
  submitDriResponseAction,
  verifyAndCloseIssueAction,
} from "@/lib/actions/issues";

type ModalKind = "assign" | "approve" | "return" | "respond" | "corrective" | "verify" | "edit" | "delete" | null;

// Partial: the stepper only ever indexes STATUS_ORDER's 5 forward stages —
// 'reopened' is a loop-back, not a stepper stage (see constants.ts).
const STEP_ICON: Partial<Record<IssueStatus, string>> = {
  new: "ph-sparkle",
  assigned: "ph-user-plus",
  in_progress: "ph-wrench",
  resolved: "ph-check",
  verified_closed: "ph-check-circle",
};

export function IssueDetailClient({
  issue,
  history,
  photos,
  categories,
  dris,
  sectorDris,
  permissions,
}: {
  issue: IssueWithRelations;
  history: { id: string; occurred_at: string; actor_label: string; actor_role: UserRole | null; action: string; note: string | null }[];
  photos: { id: string; url: string | null; file_name: string | null }[];
  categories: { id: string; name: string }[];
  dris: { id: string; name: string; phone: string | null; email: string }[];
  /** DRIs whose assigned sector matches this finding — offered by the Approve & Assign picker
   *  so a State Coordinator can't route a finding to a DRI who won't even be able to see it
   *  afterward (see DECISIONS.md #22). */
  sectorDris: { id: string; name: string; phone: string | null; email: string }[];
  permissions: {
    isViewer: boolean;
    isSuperAdmin: boolean;
    canAssign: boolean;
    canReview: boolean;
    canRespond: boolean;
    canCorrective: boolean;
    canVerify: boolean;
    canEditOrDelete: boolean;
  };
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>(null);
  const [note, setNote] = useState("");
  const [driId, setDriId] = useState("");
  const [editForm, setEditForm] = useState({ categoryId: issue.category_id, priority: issue.priority, description: issue.description });

  const currentIdx = STATUS_ORDER.indexOf(issue.status);
  const statusColor = STATUS_COLOR[issue.status];
  const priorityColor = PRIORITY_COLOR[issue.priority];

  function closeModal() {
    setModal(null);
    setNote("");
    setDriId("");
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <div>
        <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: 0 }} onClick={() => router.back()}>
          <i className="ph ph-arrow-left" /> Back
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>{issue.code}</h2>
            <span className="tag" style={{ background: tagBg(statusColor), color: statusColor }}>
              {STATUS_LABEL[issue.status]}
            </span>
            <span className="tag" style={{ background: tagBg(priorityColor), color: priorityColor }}>
              {PRIORITY_LABEL[issue.priority]}
            </span>
          </div>
          <h4 style={{ margin: 0, fontWeight: 500 }}>{issue.category?.name}</h4>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!permissions.isViewer && permissions.canAssign && (
            <button className="btn btn-primary" onClick={() => setModal("assign")}>
              <i className="ph ph-user-plus" /> Assign DRI
            </button>
          )}
          {!permissions.isViewer && permissions.canReview && (
            <>
              <button className="btn btn-primary" onClick={() => setModal("approve")}>
                <i className="ph ph-check" /> Approve &amp; Assign
              </button>
              <button className="btn btn-secondary" onClick={() => setModal("return")}>
                <i className="ph ph-arrow-u-up-left" /> Return for Correction
              </button>
            </>
          )}
          {!permissions.isViewer && permissions.canRespond && (
            <button className="btn btn-primary" onClick={() => setModal("respond")}>
              <i className="ph ph-chat-circle-text" /> Record DRI Response
            </button>
          )}
          {!permissions.isViewer && permissions.canCorrective && (
            <button className="btn btn-primary" onClick={() => setModal("corrective")}>
              <i className="ph ph-wrench" /> Record Corrective Action
            </button>
          )}
          {!permissions.isViewer && permissions.canVerify && (
            <button className="btn btn-primary" onClick={() => setModal("verify")}>
              <i className="ph ph-check-circle" /> Verify &amp; Close
            </button>
          )}
          {(permissions.isSuperAdmin || permissions.canReview) && (
            <button className="btn btn-secondary" onClick={() => setModal("edit")}>
              <i className="ph ph-note-pencil" /> Edit Submission
            </button>
          )}
          {permissions.isSuperAdmin && (
            <button className="btn btn-secondary" onClick={() => setModal("delete")}>
              <i className="ph ph-trash" /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 4, position: "relative" }}>
          {/* Connecting track behind the dots: an unreached base line the full width, plus a
              filled portion (accent) sized to how far through the 5 stages the issue has
              progressed — so this reads as an actual stepper, not 5 isolated dots. */}
          <div style={{ position: "absolute", top: 12, left: "10%", right: "10%", height: 2, background: "var(--color-divider)", zIndex: 0 }} />
          <div
            style={{
              position: "absolute", top: 12, left: "10%", height: 2, background: "var(--color-accent)", zIndex: 0,
              width: currentIdx < 0 ? 0 : `${(Math.min(currentIdx, STATUS_ORDER.length - 1) / (STATUS_ORDER.length - 1)) * 80}%`,
            }}
          />
          {STATUS_ORDER.map((s, idx) => {
            const reached = idx <= currentIdx;
            return (
              <div key={s} style={{ flex: 1, textAlign: "center", position: "relative", zIndex: 1 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    margin: "0 auto 6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: reached ? STATUS_COLOR[s] : "var(--color-neutral-200)",
                    color: reached ? "var(--color-surface)" : "var(--color-neutral-500)",
                    border: reached ? "none" : "1px solid var(--color-divider)",
                  }}
                >
                  <i className={`ph ${STEP_ICON[s]}`} style={{ fontSize: 11 }} />
                </div>
                <div style={{ fontSize: 11, color: reached ? "var(--color-text)" : "var(--color-neutral-500)" }}>{STATUS_LABEL[s]}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {issue.auto_generated && <AutoCheckCard issue={issue} />}
          <div className="card elev-sm">
            <div className="card-title">Description</div>
            <p className="card-body">{issue.description}</p>
            <div className="hr" style={{ margin: "6px 0" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
              <div>
                <span className="text-muted">State / LGA / Ward</span>
                <br />
                {issue.state?.name} / {issue.lga?.name} / {issue.ward_ref?.name ?? issue.ward ?? "—"}
              </div>
              <div>
                <span className="text-muted">Settlement / Activity Site</span>
                <br />
                {issue.settlement || issue.activity_site ? (
                  [issue.settlement && `${issue.settlement} (Settlement)`, issue.activity_site && `${issue.activity_site} (Activity Site)`]
                    .filter(Boolean)
                    .join(" / ")
                ) : issue.location_other ? (
                  <span style={{ color: "var(--status-reopened)" }} title="Typed manually in the field — not yet in the reference list. Add it via Master Data if it should be tracked going forward.">
                    {issue.location_other} (not in reference list)
                  </span>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <span className="text-muted">GPS Coordinates</span>
                <br />
                {issue.lat}, {issue.lng}
              </div>
              <div>
                <span className="text-muted">Reported</span>
                <br />
                {new Date(issue.reported_at).toLocaleString()}
              </div>
              <div>
                <span className="text-muted">Reported by</span>
                <br />
                {issue.reporter?.name ?? "—"}
              </div>
              <div>
                <span className="text-muted">Assigned DRI</span>
                <br />
                {issue.dri?.name ?? "Unassigned"}
              </div>
              <div>
                <span className="text-muted">Resolution Date</span>
                <br />
                {issue.resolution_date ? new Date(issue.resolution_date).toLocaleString() : "Pending"}
              </div>
            </div>
          </div>

          <div className="card elev-sm">
            <div className="card-title">Photographs &amp; Attachments</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 6 }}>
              {photos.length === 0 && (
                <div className="text-muted" style={{ fontSize: 12.5, gridColumn: "1 / -1" }}>
                  No photos uploaded.
                </div>
              )}
              {photos.map((p) =>
                p.url ? (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.file_name ?? "Field photo"} style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8 }} />
                  </a>
                ) : null,
              )}
            </div>
          </div>

          {issue.dri_response && (
            <div className="card elev-sm">
              <div className="card-title">DRI Response</div>
              <p className="card-body">{issue.dri_response}</p>
            </div>
          )}
          {issue.corrective_action && (
            <div className="card elev-sm">
              <div className="card-title">Corrective Action Taken</div>
              <p className="card-body">{issue.corrective_action}</p>
            </div>
          )}
        </div>

        <div className="card elev-sm">
          <div className="card-title">Activity History</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
            {history.map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 8, padding: "9px 0", borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)", flex: "none", marginTop: 6 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5 }}>
                    <strong style={{ fontWeight: 500 }}>{h.action}</strong>
                  </div>
                  <div className="text-muted" style={{ fontSize: 11.5, margin: "2px 0" }}>
                    {new Date(h.occurred_at).toLocaleString()} · {h.actor_label}
                    {h.actor_role && ` (${ROLE_LABELS[h.actor_role]})`}
                  </div>
                  {h.note && <div style={{ fontSize: 12 }}>{h.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modal === "assign" && (
        <Modal title="Assign to DRI" confirmLabel="Assign" confirmDisabled={!driId} onClose={closeModal} onConfirm={() => assignIssueAction(issue.id, driId, note)}>
          <div className="dialog-body">
            <div className="field">
              <label>Assign to a Direct Responsible Individual (DRI)</label>
              <select className="input" value={driId} onChange={(e) => setDriId(e.target.value)}>
                <option value="">Select a DRI…</option>
                {dris.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {modal === "approve" && (
        <Modal
          title="Approve & Assign"
          confirmLabel="Approve & Assign"
          confirmDisabled={!driId}
          onClose={closeModal}
          onConfirm={() => approveAndAssignFindingAction(issue.id, driId, note)}
        >
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>Approving routes this Finding straight to the selected DRI, who is notified immediately.</p>
            <div className="field">
              <label>Assign to a Direct Responsible Individual (DRI)</label>
              <select className="input" value={driId} onChange={(e) => setDriId(e.target.value)}>
                <option value="">Select a DRI…</option>
                {sectorDris.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {sectorDris.length === 0 && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  No DRI is set up for this Finding&apos;s facility level yet — assign one under Users &amp; Access first.
                </div>
              )}
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the DRI should know…" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "return" && (
        <Modal title="Return for Correction" confirmLabel="Return" confirmDisabled={!note.trim()} onClose={closeModal} onConfirm={() => returnFindingForCorrectionAction(issue.id, note)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>The original reporter is notified and can resubmit for review once corrected.</p>
            <div className="field">
              <label>What needs correcting?</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain what needs to change before this can be approved…" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "respond" && (
        <Modal title="Record DRI Response" onClose={closeModal} onConfirm={() => submitDriResponseAction(issue.id, note, note)}>
          <div className="dialog-body">
            <div className="field">
              <label>Response</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the response to this Finding…" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "corrective" && (
        <Modal title="Record Corrective Action" onClose={closeModal} onConfirm={() => recordCorrectiveActionAction(issue.id, note, note)}>
          <div className="dialog-body">
            <div className="field">
              <label>Corrective action taken</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the remedial action completed…" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "verify" && (
        <Modal title="Verify & Close" confirmLabel="Verify & Close" onClose={closeModal} onConfirm={() => verifyAndCloseIssueAction(issue.id, note)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>Confirm this Finding has been resolved during a follow-up visit.</p>
            <div className="field">
              <label>Notes</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add supporting detail…" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "edit" && (
        <Modal
          title="Edit Submission"
          onClose={closeModal}
          onConfirm={() => editIssueSubmissionAction(issue.id, editForm.categoryId, editForm.priority as IssuePriority, editForm.description)}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Facility level</label>
              <select className="input" value={editForm.categoryId} onChange={(e) => setEditForm((f) => ({ ...f, categoryId: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select className="input" value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as IssuePriority }))}>
                {(["critical", "high", "medium", "low"] as IssuePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea className="input" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "delete" && (
        <Modal
          title="Delete Submission"
          confirmLabel="Delete"
          onClose={closeModal}
          onConfirm={async () => {
            const result = await deleteIssueSubmissionAction(issue.id);
            if (!result.error) router.push("/issues");
            return result;
          }}
        >
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Delete submission <strong>{issue.code}</strong> permanently? This removes it from all lists, the map, and reports. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Labels for the measurements an automatic check stores in `issues.metric` (migration 0102). */
const METRIC_LABEL: Record<string, string> = {
  variance_pct: "Variance %",
  threshold: "Limit",
  counted: "Counted (sachets)",
  ledger_balance: "Ledger balance (sachets)",
  count_date: "Count date",
  sachets_issued: "Issued (sachets)",
  sachets_received: "Received (sachets)",
  gap: "Gap (sachets)",
  transfer_code: "Transfer",
  days_in_transit: "Days in transit",
  threshold_days: "Limit (days)",
  stockout_days: "Days out of stock",
  first_day: "First day",
  lot_no: "Lot",
  expiry_date: "Expired on",
  balance: "Balance (sachets)",
  short_pct: "Short %",
  sachets_prescribed: "Prescribed (sachets)",
  sachets_dispensed: "Dispensed (sachets)",
  longest_gap_days: "Longest gap (days)",
  gap_limit_days: "Gap limit (days)",
  month_end_count: "Month-end count done",
  adjustment: "Adjustment (sachets)",
  balance_before: "Balance before (sachets)",
  pct: "% of balance",
};

function formatMetric(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-GB");
  return String(v);
}

/** What the automatic check measured — RUTF auto-Findings are for review, not accusation. */
function AutoCheckCard({ issue }: { issue: IssueWithRelations }) {
  const metric = (issue.metric ?? {}) as Record<string, unknown>;
  const rows = Object.entries(metric).filter(([k, v]) => k in METRIC_LABEL && v !== null && typeof v !== "object");
  return (
    <div className="card elev-sm" style={{ borderLeft: "3px solid var(--color-accent-600)" }}>
      <div className="card-kicker">
        <i className="ph ph-robot" /> Automatic check · {issue.finding?.label ?? issue.finding_type}
      </div>
      <p className="card-body" style={{ marginTop: 4 }}>
        Raised from the stock ledger for review
        {issue.period_start && issue.period_end ? ` (period ${issue.period_start} to ${issue.period_end})` : ""}.
      </p>
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, fontSize: 13, marginTop: 8 }}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <span className="text-muted">{METRIC_LABEL[k]}</span>
              <br />
              <strong>{formatMetric(v)}</strong>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 13 }}>
        {issue.facility && (
          <a href={`/stock-ledger?facility=${issue.facility.id}`}>
            <i className="ph ph-book-open-text" /> {issue.facility.name} — stock ledger
          </a>
        )}
        {issue.transfer_id && (
          <a href={`/transfers?transfer=${issue.transfer_id}`}>
            <i className="ph ph-truck" /> Transfer
          </a>
        )}
      </div>
    </div>
  );
}
