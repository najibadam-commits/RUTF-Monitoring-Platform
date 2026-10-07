"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import type { Database } from "@/lib/types/database";
import { updateThresholdAction } from "@/lib/actions/referenceData";

type Threshold = Database["public"]["Tables"]["rutf_thresholds"]["Row"];

// The rule book (DECISIONS R122): every threshold with its area, a plain name, its unit and the
// screen that uses it.
type Rule = { area: string; label: string; unit?: string; usedOn: { label: string; href: string } };
const RULES: Record<string, Rule> = {
  variance_pct_max: { area: "Stock", label: "Stock variance limit", unit: "%", usedOn: { label: "Stock Reconciliation", href: "/stock-integrity" } },
  variance_pct_max_remote: { area: "Stock", label: "Stock variance limit, hard-to-reach facilities", unit: "%", usedOn: { label: "Stock Reconciliation", href: "/stock-integrity" } },
  adjustment_pct_max: { area: "Stock", label: "Adjustment needing supervisor confirmation", unit: "% of balance", usedOn: { label: "Stock Ledger", href: "/stock-ledger" } },
  count_due_day: { area: "Stock", label: "Month-end count due by", unit: "day of next month", usedOn: { label: "Completeness & Timeliness", href: "/reporting-completeness" } },
  receipt_confirm_days: { area: "Transfers", label: "Receipt to be confirmed within", unit: "days", usedOn: { label: "Transfers", href: "/transfers" } },
  short_dispense_pct: { area: "Dispensing", label: "Short-dispensing limit", unit: "%", usedOn: { label: "Last-Mile Dispensing", href: "/otp-dispensing" } },
  vf_min: { area: "Dispensing", label: "Register check — lowest accepted", usedOn: { label: "Last-Mile Dispensing", href: "/otp-dispensing" } },
  vf_max: { area: "Dispensing", label: "Register check — highest accepted", usedOn: { label: "Last-Mile Dispensing", href: "/otp-dispensing" } },
  reporting_gap_days: { area: "Reporting", label: "Longest gap between daily dispensing entries", unit: "days", usedOn: { label: "Completeness & Timeliness", href: "/reporting-completeness" } },
  geofence_m: { area: "Supervision", label: "Visit must be within", unit: "metres of the facility", usedOn: { label: "Risk-Based Supervision", href: "/supervision" } },
  risk_high: { area: "Supervision", label: "High-risk score (visited monthly)", unit: "of 100", usedOn: { label: "Risk-Based Planner", href: "/supervision?tab=planner" } },
  visits_per_supervisor_month: { area: "Supervision", label: "Visits per supervisor a month", unit: "visits", usedOn: { label: "Risk-Based Planner", href: "/supervision?tab=planner" } },
  finding_target_days: { area: "Findings", label: "Finding target — report to verified closure", unit: "days", usedOn: { label: "Accountability Scorecard", href: "/accountability" } },
  sync_stale_days: { area: "Phones", label: "Phone counts as not syncing after", unit: "days", usedOn: { label: "Offline Sync Health", href: "/devices" } },
};
const AREAS = ["Stock", "Transfers", "Dispensing", "Reporting", "Supervision", "Findings", "Phones", "Other"];
const AREA_ICON: Record<string, string> = {
  Stock: "ph-package", Transfers: "ph-truck", Dispensing: "ph-hand-heart", Reporting: "ph-check-square-offset",
  Supervision: "ph-clipboard-text", Findings: "ph-flag", Phones: "ph-device-mobile", Other: "ph-sliders-horizontal",
};
const LABEL: Record<string, string> = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.label]));

export function ThresholdsTab({ thresholds, projectName, isSuperAdmin }: { thresholds: Threshold[]; projectName: Record<string, string>; isSuperAdmin: boolean }) {
  const [target, setTarget] = useState<Threshold | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const multipleProjects = new Set(thresholds.map((t) => t.project_id)).size > 1;

  return (
    <>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 860 }}>
        The platform&apos;s rule book: every flag, Finding, target and colour on the platform comes from these values, so the
        checks are the same for every facility and anyone can see why something was flagged. A change shows on the screens straight away, applies to the
        automatic checks from the next nightly run, and is recorded in the Audit Trail. The values are proposed defaults (brief §12.4) for the programme to
        confirm with the State team.{!isSuperAdmin && " Only Super Admin can change them."}
      </p>
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {multipleProjects && <th>Project</th>}
              <th>Rule</th>
              <th style={{ textAlign: "right" }}>Value</th>
              <th>What it means</th>
              <th>Used on</th>
              {isSuperAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {AREAS.flatMap((area) => {
              const inArea = thresholds.filter((t) => (RULES[t.key]?.area ?? "Other") === area);
              if (!inArea.length) return [];
              return [
                <tr key={`area-${area}`}>
                  <td colSpan={(multipleProjects ? 1 : 0) + (isSuperAdmin ? 5 : 4)} style={{ background: "var(--color-neutral-100)", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--color-neutral-700)", padding: "6px 12px" }}>
                    <i className={`ph ${AREA_ICON[area]}`} aria-hidden="true" /> {area}
                  </td>
                </tr>,
                ...inArea.map((t) => {
                  const rule = RULES[t.key];
                  return (
              <tr key={`${t.project_id}|${t.key}`}>
                {multipleProjects && <td>{projectName[t.project_id] ?? "—"}</td>}
                <td>
                  {rule?.label ?? t.key}
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {t.key}
                  </div>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <strong style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>{t.value}</strong>
                  {rule?.unit && <span className="text-muted" style={{ fontSize: 11.5 }}> {rule.unit}</span>}
                </td>
                <td className="text-muted" style={{ fontSize: 12.5, maxWidth: 360 }}>
                  {t.note}
                  <div style={{ fontSize: 11 }}>Last changed {new Date(t.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                </td>
                <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                  {rule ? <Link href={rule.usedOn.href}>{rule.usedOn.label}</Link> : <span className="text-muted">—</span>}
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
                  );
                }),
              ];
            })}
            {thresholds.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
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
