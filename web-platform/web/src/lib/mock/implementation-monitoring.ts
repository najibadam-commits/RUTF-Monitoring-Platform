// MOCK DATA — Implementation Monitoring has no backend yet; replace with a real Supabase
// query when this feature ships (see DECISIONS.md #12). State names are real, all numbers
// here are invented for preview purposes only — do not treat as live figures.

export type ImplementationStatus = "on_track" | "behind" | "at_risk";

export interface StateImplementation {
  state: string;
  planned: number;
  implemented: number;
  status: ImplementationStatus;
}

export const IMPLEMENTATION_BY_STATE: StateImplementation[] = [
  { state: "Lagos", planned: 120, implemented: 108, status: "on_track" },
  { state: "Kano", planned: 95, implemented: 61, status: "behind" },
  { state: "Rivers", planned: 80, implemented: 74, status: "on_track" },
  { state: "Kaduna", planned: 70, implemented: 38, status: "at_risk" },
  { state: "Oyo", planned: 65, implemented: 59, status: "on_track" },
  { state: "Borno", planned: 55, implemented: 22, status: "at_risk" },
  { state: "Adamawa", planned: 50, implemented: 41, status: "behind" },
  { state: "Enugu", planned: 45, implemented: 43, status: "on_track" },
  { state: "Plateau", planned: 40, implemented: 27, status: "behind" },
  { state: "Katsina", planned: 38, implemented: 33, status: "on_track" },
];

export const IMPLEMENTATION_STATUS_META: Record<ImplementationStatus, { label: string; color: string }> = {
  on_track: { label: "On Track", color: "var(--status-resolved)" },
  behind: { label: "Behind", color: "var(--priority-high)" },
  at_risk: { label: "At Risk", color: "var(--priority-critical)" },
};
