"use client";

import { useCallback, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Database } from "@/lib/types/database";
import {
  bulkAddProtocolRulesAction,
  deleteProtocolRuleAction,
  saveProtocolRuleAction,
  type ProtocolRuleInput,
} from "@/lib/actions/referenceData";
import { CsvImportModal, type CsvField, type CsvRowResult } from "./CsvImportModal";

type Rule = Database["public"]["Tables"]["protocol_rules"]["Row"];
type Form = { protocolVersion: string; weightMinKg: string; weightMaxKg: string; sachetsPerWeek: string; effectiveFrom: string; effectiveTo: string };

const CSV_FIELDS: CsvField[] = [
  { key: "protocol_version", label: "Protocol version", required: true, keywords: ["protocol", "version"] },
  { key: "weight_min_kg", label: "Weight from (kg)", required: true, keywords: ["min"] },
  { key: "weight_max_kg", label: "Weight to (kg)", required: true, keywords: ["max"] },
  { key: "sachets_per_week", label: "Sachets per week", required: true, keywords: ["sachet", "week"] },
  { key: "effective_from", label: "Effective from", required: true, keywords: ["from", "start"] },
  { key: "effective_to", label: "Effective to", keywords: ["to", "end"] },
];

function toInput(f: Form): ProtocolRuleInput {
  return {
    protocolVersion: f.protocolVersion,
    weightMinKg: Number(f.weightMinKg),
    weightMaxKg: Number(f.weightMaxKg),
    sachetsPerWeek: Number(f.sachetsPerWeek),
    effectiveFrom: f.effectiveFrom,
    effectiveTo: f.effectiveTo || null,
  };
}

export function ProtocolTab({ rules, isSuperAdmin }: { rules: Rule[]; isSuperAdmin: boolean }) {
  const [modal, setModal] = useState<"edit" | "delete" | "csv" | null>(null);
  const [target, setTarget] = useState<Rule | null>(null);
  const [form, setForm] = useState<Form>({ protocolVersion: "", weightMinKg: "", weightMaxKg: "", sachetsPerWeek: "", effectiveFrom: "", effectiveTo: "" });

  const byVersion = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules) m.set(r.protocol_version, [...(m.get(r.protocol_version) ?? []), r]);
    return [...m.entries()];
  }, [rules]);

  function openEdit(rule: Rule | null) {
    setTarget(rule);
    setForm(
      rule
        ? {
            protocolVersion: rule.protocol_version,
            weightMinKg: String(rule.weight_min_kg),
            weightMaxKg: String(rule.weight_max_kg),
            sachetsPerWeek: String(rule.sachets_per_week),
            effectiveFrom: rule.effective_from,
            effectiveTo: rule.effective_to ?? "",
          }
        : { protocolVersion: byVersion[0]?.[0] ?? "", weightMinKg: "", weightMaxKg: "", sachetsPerWeek: "", effectiveFrom: "", effectiveTo: "" },
    );
    setModal("edit");
  }

  const validateCsv = useCallback((r: Record<string, string>, seen: Set<string>): CsvRowResult<ProtocolRuleInput> => {
    const cells = [r.protocol_version, r.weight_min_kg, r.weight_max_kg, r.sachets_per_week, r.effective_from];
    const value = toInput({
      protocolVersion: r.protocol_version,
      weightMinKg: r.weight_min_kg,
      weightMaxKg: r.weight_max_kg,
      sachetsPerWeek: r.sachets_per_week,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    });
    if (![value.weightMinKg, value.weightMaxKg, value.sachetsPerWeek].every(Number.isFinite)) return { cells, error: "Weights and sachets must be numbers" };
    if (value.weightMaxKg < value.weightMinKg) return { cells, error: "Weight-to is below weight-from" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveFrom)) return { cells, error: "Effective-from must be YYYY-MM-DD" };
    const key = `${value.protocolVersion}|${value.weightMinKg}`;
    if (seen.has(key)) return { cells, error: "Duplicate band in file" };
    seen.add(key);
    return { cells, error: null, value };
  }, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: 640 }}>
          Sachets per week by weight band — used to work out expected consumption for OTP checks. Seed values are the
          generic CMAM table; they must be signed off by the Katsina State nutrition unit.
          {!isSuperAdmin && " Only Super Admin can change them."}
        </p>
        {isSuperAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setModal("csv")}>
              <i className="ph ph-upload-simple" /> Upload CSV
            </button>
            <button className="btn btn-primary" onClick={() => openEdit(null)}>
              <i className="ph ph-plus" /> Add Band
            </button>
          </div>
        )}
      </div>

      {byVersion.map(([version, bands]) => (
        <div key={version} className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid var(--color-divider)" }}>{version}</div>
          <table className="table">
            <thead>
              <tr>
                <th>Weight (kg)</th>
                <th>Sachets / week</th>
                <th>Sachets / day</th>
                <th>Effective</th>
                {isSuperAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {bands.map((r) => (
                <tr key={r.id}>
                  <td>{Number(r.weight_max_kg) >= 999 ? `≥ ${r.weight_min_kg}` : `${r.weight_min_kg} – ${r.weight_max_kg}`}</td>
                  <td style={{ fontWeight: 500 }}>{r.sachets_per_week}</td>
                  <td className="text-muted">{(Number(r.sachets_per_week) / 7).toFixed(2)}</td>
                  <td className="text-muted" style={{ fontSize: 13 }}>
                    {r.effective_from}
                    {r.effective_to ? ` to ${r.effective_to}` : " onward"}
                  </td>
                  {isSuperAdmin && (
                    <td className="table-actions">
                      <button className="btn btn-icon btn-ghost" title="Edit" onClick={() => openEdit(r)}>
                        <i className="ph ph-pencil-simple" />
                      </button>
                      <button className="btn btn-icon btn-ghost" title="Delete" onClick={() => { setTarget(r); setModal("delete"); }}>
                        <i className="ph ph-trash" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {rules.length === 0 && <p className="text-muted">No dosing rules yet.</p>}

      {modal === "edit" && (
        <Modal
          title={target ? "Edit Band" : "Add Band"}
          confirmLabel={target ? "Save" : "Add"}
          confirmDisabled={!form.protocolVersion.trim() || !form.weightMinKg || !form.weightMaxKg || !form.sachetsPerWeek || !form.effectiveFrom}
          onClose={() => setModal(null)}
          onConfirm={() => saveProtocolRuleAction(target?.id ?? null, toInput(form))}
        >
          <div className="dialog-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Protocol version</label>
              <input className="input" value={form.protocolVersion} onChange={(e) => setForm((f) => ({ ...f, protocolVersion: e.target.value }))} />
            </div>
            <div className="field">
              <label>Weight from (kg)</label>
              <input className="input" inputMode="decimal" value={form.weightMinKg} onChange={(e) => setForm((f) => ({ ...f, weightMinKg: e.target.value }))} />
            </div>
            <div className="field">
              <label>Weight to (kg)</label>
              <input className="input" inputMode="decimal" value={form.weightMaxKg} onChange={(e) => setForm((f) => ({ ...f, weightMaxKg: e.target.value }))} />
            </div>
            <div className="field">
              <label>Sachets per week</label>
              <input className="input" inputMode="decimal" value={form.sachetsPerWeek} onChange={(e) => setForm((f) => ({ ...f, sachetsPerWeek: e.target.value }))} />
            </div>
            <div />
            <div className="field">
              <label>Effective from</label>
              <input className="input" type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
            </div>
            <div className="field">
              <label>Effective to (optional)</label>
              <input className="input" type="date" value={form.effectiveTo} onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "delete" && target && (
        <Modal title="Delete Band" confirmLabel="Delete" onClose={() => setModal(null)} onConfirm={() => deleteProtocolRuleAction(target.id)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Remove the {target.weight_min_kg}–{target.weight_max_kg} kg band from <strong>{target.protocol_version}</strong>? To retire a
              protocol, set an effective-to date instead.
            </p>
          </div>
        </Modal>
      )}

      {modal === "csv" && (
        <CsvImportModal<ProtocolRuleInput>
          title="Upload Dosing Rules CSV"
          intro="One row per weight band. New bands are added; to change an existing band, edit it here."
          fields={CSV_FIELDS}
          previewHeaders={["Version", "From kg", "To kg", "Sachets/week", "Effective from"]}
          templateCsv={"protocol_version,weight_min_kg,weight_max_kg,sachets_per_week,effective_from,effective_to\nCMAM-2027,3.5,3.9,10,2027-01-01,\n"}
          templateName="protocol-rules-template.csv"
          validate={validateCsv}
          upload={bulkAddProtocolRulesAction}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
