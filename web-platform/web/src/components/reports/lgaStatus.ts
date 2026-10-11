// LGA weekly report statuses (0136, DECISIONS R171).
export const LGA_STATUS: Record<string, { label: string; colour: string }> = {
  submitted: { label: "Waiting for review", colour: "var(--stage-addressing)" },
  under_review: { label: "Under review", colour: "var(--stage-addressing)" },
  queried: { label: "Queried", colour: "var(--priority-high)" },
  accepted: { label: "Accepted", colour: "var(--stage-recorded)" },
  returned: { label: "Returned for correction", colour: "var(--stage-reopened)" },
  rejected: { label: "Rejected", colour: "var(--stage-reopened)" },
  draft: { label: "Draft, not submitted", colour: "var(--color-neutral-600)" },
  not_started: { label: "Not started", colour: "var(--color-neutral-500)" },
};
