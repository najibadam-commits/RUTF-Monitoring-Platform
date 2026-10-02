// MOCK DATA — Coverage Analysis has no backend yet; replace with a real Supabase query when
// this feature ships (see DECISIONS.md #12). State names are real; coverage percentages and
// "covered" counts below are invented for preview purposes only — do not treat as live figures.

export interface StateCoverage {
  state: string;
  coveragePct: number;
}

export const COVERAGE_BY_STATE: StateCoverage[] = [
  { state: "Lagos", coveragePct: 92 },
  { state: "Rivers", coveragePct: 87 },
  { state: "Oyo", coveragePct: 81 },
  { state: "Enugu", coveragePct: 76 },
  { state: "Kano", coveragePct: 68 },
  { state: "Kaduna", coveragePct: 54 },
  { state: "Adamawa", coveragePct: 47 },
  { state: "Borno", coveragePct: 33 },
];

// Static national totals — the same figures already shown on the login page's stat blocks
// (37 states, 774 LGAs) and supabase/seed.sql's own comment (~9,411 wards). These are real;
// only the *_COVERED_MOCK numerators below are invented.
export const TOTAL_STATES = 37;
export const TOTAL_LGAS = 774;
export const TOTAL_WARDS = 9411;

export const STATES_COVERED_MOCK = 24;
export const LGAS_COVERED_MOCK = 412;
export const WARDS_COVERED_MOCK = 3860;
