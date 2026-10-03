"use client";

/** What a supervisor supervises (web migration 0103): stores or OTP sites, in which LGAs. */
export type SupervisionLevel = "stores" | "otp_sites";

export function SupervisorScopePicker({
  level,
  lgaIds,
  lgas,
  onChange,
}: {
  level: SupervisionLevel | "";
  lgaIds: string[];
  lgas: { id: string; name: string }[];
  onChange: (next: { level: SupervisionLevel | ""; lgaIds: string[] }) => void;
}) {
  const toggle = (id: string) => onChange({ level, lgaIds: lgaIds.includes(id) ? lgaIds.filter((x) => x !== id) : [...lgaIds, id] });
  return (
    <>
      <div className="field">
        <label>Supervises</label>
        <select className="input" value={level} onChange={(e) => onChange({ level: e.target.value as SupervisionLevel | "", lgaIds })}>
          <option value="">Select…</option>
          <option value="otp_sites">OTP sites (LGA Nutrition Officer)</option>
          <option value="stores">Stores — LGA stores and the State store (State officer)</option>
        </select>
      </div>
      <div className="field">
        <label>
          LGAs {lgaIds.length > 0 && <span className="text-muted">({lgaIds.length} selected)</span>}
        </label>
        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 12px",
            maxHeight: 180, overflowY: "auto", padding: 8, border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)",
          }}
        >
          {lgas.map((l) => (
            <label key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={lgaIds.includes(l.id)} onChange={() => toggle(l.id)} />
              {l.name}
            </label>
          ))}
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          This supervisor can record visits only at the {level === "stores" ? "stores" : "OTP sites"} in these LGAs
          {level === "stores" ? " (and the State store)" : ""}, and confirms their adjustments.
        </div>
      </div>
    </>
  );
}
