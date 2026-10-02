"use client";

import { useMemo, useState } from "react";
import type { FacilityType } from "@/lib/types/database";

/** Facilities a facility user (`dri`) can be assigned to: stores and OTP sites only — other
 *  health facilities don't hold RUTF (RUTF DECISIONS R15). */
export type FacilityOption = { id: string; name: string; facility_type: FacilityType; lga_id: string; national_code: string | null };

const TYPE_ORDER: FacilityType[] = ["state_store", "lga_store", "health_facility"];
const GROUP_LABEL: Record<FacilityType, string> = { state_store: "State store", lga_store: "LGA stores", health_facility: "OTP sites" };

export function FacilityPicker({
  value,
  onChange,
  facilities,
  lgas,
}: {
  value: string;
  onChange: (facilityId: string) => void;
  facilities: FacilityOption[];
  lgas: { id: string; name: string }[];
}) {
  const current = facilities.find((f) => f.id === value);
  const [lgaId, setLgaId] = useState(current?.lga_id ?? "");
  const groups = useMemo(() => {
    const visible = facilities.filter((f) => !lgaId || f.lga_id === lgaId || f.facility_type === "state_store");
    return TYPE_ORDER.map((t) => ({ type: t, items: visible.filter((f) => f.facility_type === t) })).filter((g) => g.items.length);
  }, [facilities, lgaId]);

  return (
    <div className="field">
      <label>Facility</label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)", gap: 8 }}>
        <select className="input" value={lgaId} onChange={(e) => setLgaId(e.target.value)} aria-label="Filter facilities by LGA">
          <option value="">All LGAs</option>
          {lgas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a facility…</option>
          {groups.map((g) => (
            <optgroup key={g.type} label={GROUP_LABEL[g.type]}>
              {g.items.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
        This facility user records stock for this facility only, and sees Findings for its level.
      </div>
    </div>
  );
}
