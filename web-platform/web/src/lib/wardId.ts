// LGA and Ward IDs in the platform's administrative order (DECISIONS R79, R80): STATE-LGA, e.g. KT-DAU,
// and STATE-LGA-WARD, e.g. KT-DAU-MAJ —
// the first three parts of every Facility, Finding, transfer and visit ID. Built from the stored
// codes (states.code, lgas.abbr, wards.abbr); the ward's official numeric code (wards.code) stays
// as it is.
export function lgaId(stateCode: string | null | undefined, lgaAbbr: string | null | undefined) {
  return stateCode && lgaAbbr ? `${stateCode}-${lgaAbbr}` : null;
}

export function wardId(stateCode: string | null | undefined, lgaAbbr: string | null | undefined, wardAbbr: string | null | undefined) {
  return stateCode && lgaAbbr && wardAbbr ? `${stateCode}-${lgaAbbr}-${wardAbbr}` : null;
}
