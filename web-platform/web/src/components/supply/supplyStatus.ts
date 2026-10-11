// Supply request statuses (0135, DECISIONS R170) — labels and colours shared by the list and the detail page.
export const SUPPLY_STATUS: Record<string, { label: string; colour: string }> = {
  submitted: { label: "Waiting for review", colour: "var(--stage-addressing)" },
  under_review: { label: "Under review", colour: "var(--stage-addressing)" },
  queried: { label: "Queried", colour: "var(--priority-high)" },
  approved: { label: "Approved, not yet sent", colour: "var(--stage-recorded)" },
  partially_fulfilled: { label: "Partly sent", colour: "var(--priority-high)" },
  dispatched: { label: "Dispatched", colour: "var(--stage-recorded)" },
  received: { label: "Received", colour: "var(--status-resolved)" },
  rejected: { label: "Rejected", colour: "var(--stage-reopened)" },
  cancelled: { label: "Cancelled", colour: "var(--color-neutral-600)" },
};

export type SupplyRow = {
  id: string; code: string; level: "otp_to_lga" | "lga_to_state"; status: string; submitted_at: string; decided_at: string | null; needed_by: string | null;
  resubmitted_count: number; from_facility_id: string; from_name: string; from_lga: string; to_facility_id: string; to_name: string;
  requested_qty: number | null; approved_qty: number | null; dispatched_qty: number | null; last_activity: string | null; i_review: boolean; i_requested: boolean;
};
