"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Database } from "@/lib/types/database";
import { updateThresholdAction } from "@/lib/actions/referenceData";

type Threshold = Database["public"]["Tables"]["rutf_thresholds"]["Row"];

const LABEL: Record<string, string> = {
  variance_pct_max: "Stock variance limit (%)",
  variance_pct_max_remote: "Stock variance limit, hard-to-reach (%)",
  vf_min: "OTP verification factor — minimum",
  vf_max: "OTP verification factor — maximum",
  geofence_m: "Supervision visit geofence (m)",
  short_dispense_pct: "Short-dispensing limit (%)",
  finding_target_days: "Finding target — days to verified & closed",
};

export function ThresholdsTab({ thresholds, projectName, isSuperAdmin }: { thresholds: Threshold[]; projectName: Record<string, string>; isSuperAdmin: boolean }) {
  const [target, setTarget] = useState<Threshold | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const multipleProjects = new Set(thresholds.map((t) => t.project_id)).size > 1;

  return (
    <>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 640 }}>
        Limits that turn a discrepancy into a Finding. Seed values are brief §12.4 defaults to be confirmed with the programme.
        {!isSuperAdmin && " Only Super Admin can change them."}
      </p>
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {multipleProjects && <th>Project</th>}
              <th>Threshold</th>
              <th>Value</th>
              <th>Note</th>
              {isSuperAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {thresholds.map((t) => (
              <tr key={`${t.project_id}|${t.key}`}>
                {multipleProjects && <td>{projectName[t.project_id] ?? "—"}</td>}
                <td>
                  {LABEL[t.key] ?? t.key}
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {t.key}
                  </div>
                </td>
                <td style={{ fontWeight: 600 }}>{t.value}</td>
                <td className="text-muted" style={{ fontSize: 13 }}>
                  {t.note}
                </td>
                {isSuperAdmin && (
                  <td className="table-actions">
                    <button
                      className="btn btn-icon btn-ghost"
                      title="Edit"
                      onClick={() => {
                        setTarget(t);
                        setValue(String(t.value));
                        setNote(t.note ?? "");
                      }}
                    >
                      <i className="ph ph-pencil-simple" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {thresholds.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No thresholds set.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {target && (
        <Modal
          title={LABEL[target.key] ?? target.key}
          confirmLabel="Save"
          confirmDisabled={!value.trim() || !Number.isFinite(Number(value))}
          onClose={() => setTarget(null)}
          onConfirm={() => updateThresholdAction(target.project_id, target.key, Number(value), note)}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Value</label>
              <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="field">
              <label>Note</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
