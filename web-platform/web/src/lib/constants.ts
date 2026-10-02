import type { DownloadRequestStatus, IssuePriority, IssueStatus } from "@/lib/types/database";

// Shared by the update-password page's client-side hint (minLength attribute) and
// updatePassword's own server-side enforcement in lib/actions/auth.ts — one source of truth so
// the two can't drift apart.
export const MIN_PASSWORD_LENGTH = 8;

// Mirrors design_handoff_tpm_monitoring_platform/mock-data.js — STATUS_ORDER,
// STATUS_COLOR, PRIORITY_COLOR — with the enum's snake_case DB values mapped
// to the design's display labels/colors. STATUS_ORDER intentionally stays
// the original 5-stage forward sequence (stepper/legend/KPI cards) — the
// mobile app's 'reopened' status (migration 0016, Final Verification "not
// resolved" path) is a loop-back, not a 6th forward stage, so it's covered
// in STATUS_LABEL/STATUS_COLOR (nothing renders blank for it) but left out
// of the forward-progress stepper. Revisit if reopened issues need their
// own stepper/filter treatment.

// STATUS_ORDER intentionally still excludes pending_review/returned_for_correction (State
// Coordinator review — see DECISIONS.md #22), same reasoning as leaving out reopened: both are a
// gate/loop-back before the original 5-stage forward sequence starts, not a 6th/7th forward stage
// — nothing renders blank for them (STATUS_LABEL/STATUS_COLOR below cover every status), they're
// just left out of the stepper/legend/KPI cards' fixed 5 steps.
export const STATUS_ORDER: IssueStatus[] = ["new", "assigned", "in_progress", "resolved", "verified_closed"];

/** Every real status, for the Issues list/GIS filter dropdowns — unlike STATUS_ORDER above,
 *  this must include pending_review/returned_for_correction/reopened so a State Coordinator can
 *  actually filter for Findings awaiting their review (see DECISIONS.md #22). */
export const STATUS_FILTER_OPTIONS: IssueStatus[] = [
  "pending_review",
  "returned_for_correction",
  "new",
  "assigned",
  "in_progress",
  "resolved",
  "verified_closed",
  "reopened",
];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  new: "New",
  pending_review: "Pending Review",
  returned_for_correction: "Returned for Correction",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
  verified_closed: "Verified/Closed",
  reopened: "Reopened",
};

export const STATUS_COLOR: Record<IssueStatus, string> = {
  new: "var(--status-new)",
  pending_review: "var(--status-pending-review)",
  returned_for_correction: "var(--status-returned-for-correction)",
  assigned: "var(--status-assigned)",
  in_progress: "var(--status-in-progress)",
  resolved: "var(--status-resolved)",
  verified_closed: "var(--status-verified-closed)",
  reopened: "var(--status-reopened)",
};

export const PRIORITY_ORDER: IssuePriority[] = ["critical", "high", "medium", "low"];

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_COLOR: Record<IssuePriority, string> = {
  critical: "var(--priority-critical)",
  high: "var(--priority-high)",
  medium: "var(--priority-medium)",
  low: "var(--priority-low)",
};

export function tagBg(color: string) {
  return `color-mix(in srgb, ${color} 20%, transparent)`;
}

export const DOWNLOAD_REQUEST_STATUS_LABEL: Record<DownloadRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  fulfilled: "Downloaded",
};

export const DOWNLOAD_REQUEST_STATUS_COLOR: Record<DownloadRequestStatus, string> = {
  pending: "var(--priority-high)",
  approved: "var(--status-resolved)",
  rejected: "var(--priority-critical)",
  fulfilled: "var(--status-verified-closed)",
};
