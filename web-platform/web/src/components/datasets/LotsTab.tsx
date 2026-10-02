"use client";

import { useCallback, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { tagBg } from "@/lib/constants";
import type { Database } from "@/lib/types/database";
import { addLotAction, bulkAddLotsAction, deleteLotAction, updateLotAction, type LotInput } from "@/lib/actions/referenceData";
import { CsvImportModal, type CsvField, type CsvRowResult } from "./CsvImportModal";

type Lot = Database["public"]["Tables"]["product_lots"]["Row"];
type Product = Pick<Database["public"]["Tables"]["products"]["Row"], "id" | "name" | "units_per_carton" | "shelf_life_months">;

const EXPIRY_WARN_DAYS = 90;
const DAY_MS = 86_400_000;

function expiryState(expiry: string, today: number) {
  const days = Math.floor((Date.parse(expiry) - today) / DAY_MS);
  if (days < 0) return { label: "Expired", color: "var(--priority-critical)" };
  if (days <= EXPIRY_WARN_DAYS) return { label: `Expires in ${days} day${days === 1 ? "" : "s"}`, color: "var(--priority-high)" };
  return { label: "In date", color: "var(--status-resolved)" };
}

const CSV_FIELDS: CsvField[] = [
  { key: "lot_no", label: "Lot number", required: true, keywords: ["lot", "batch"] },
  { key: "expiry_date", label: "Expiry date (YYYY-MM-DD)", required: true, keywords: ["expir", "exp"] },
  { key: "product", label: "Product", keywords: ["product"] },
];

export function LotsTab({ lots, products, isSuperAdmin, today }: { lots: Lot[]; products: Product[]; isSuperAdmin: boolean; today: number }) {
  const [modal, setModal] = useState<"add" | "edit" | "delete" | "csv" | null>(null);
  const [target, setTarget] = useState<Lot | null>(null);
  const [form, setForm] = useState<LotInput>({ productId: products[0]?.id ?? "", lotNo: "", expiryDate: "" });
  const productName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);

  function close() {
    setModal(null);
    setTarget(null);
    setForm({ productId: products[0]?.id ?? "", lotNo: "", expiryDate: "" });
  }

  const existing = useMemo(() => new Set(lots.map((l) => `${l.product_id}|${l.lot_no.toLowerCase()}`)), [lots]);
  const validateCsv = useCallback(
    (r: Record<string, string>, seen: Set<string>): CsvRowResult<LotInput> => {
      const cells = [r.lot_no, r.expiry_date, r.product || products[0]?.name || ""];
      const product = r.product ? products.find((p) => p.name.toLowerCase() === r.product.toLowerCase()) : products.length === 1 ? products[0] : undefined;
      if (!product) return { cells, error: r.product ? `Unknown product "${r.product}"` : "Product is required (more than one product exists)" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiry_date) || Number.isNaN(Date.parse(r.expiry_date))) return { cells, error: "Expiry date must be YYYY-MM-DD" };
      const key = `${product.id}|${r.lot_no.toLowerCase()}`;
      if (existing.has(key)) return { cells, error: "Lot already exists" };
      if (seen.has(key)) return { cells, error: "Duplicate row in file" };
      seen.add(key);
      return { cells, error: null, value: { productId: product.id, lotNo: r.lot_no, expiryDate: r.expiry_date } };
    },
    [products, existing],
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {products.map((p) => `${p.name}: ${p.units_per_carton} per carton${p.shelf_life_months ? `, ${p.shelf_life_months}-month shelf life` : ""}`).join(" · ")}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setModal("csv")}>
            <i className="ph ph-upload-simple" /> Upload CSV
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>
            <i className="ph ph-plus" /> Add Lot
          </button>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Lot number</th>
              <th>Product</th>
              <th>Expiry</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const state = expiryState(lot.expiry_date, today);
              return (
                <tr key={lot.id}>
                  <td style={{ fontWeight: 500 }}>{lot.lot_no}</td>
                  <td>{productName[lot.product_id] ?? "—"}</td>
                  <td>{lot.expiry_date}</td>
                  <td>
                    <span className="tag" style={{ background: tagBg(state.color), color: state.color }}>
                      {state.label}
                    </span>
                  </td>
                  <td className="table-actions">
                    <button
                      className="btn btn-icon btn-ghost"
                      title="Edit"
                      onClick={() => {
                        setTarget(lot);
                        setForm({ productId: lot.product_id, lotNo: lot.lot_no, expiryDate: lot.expiry_date });
                        setModal("edit");
                      }}
                    >
                      <i className="ph ph-pencil-simple" />
                    </button>
                    {isSuperAdmin && (
                      <button className="btn btn-icon btn-ghost" title="Delete" onClick={() => { setTarget(lot); setModal("delete"); }}>
                        <i className="ph ph-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {lots.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  No lots yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(modal === "add" || modal === "edit") && (
        <Modal
          title={modal === "add" ? "Add Lot" : "Edit Lot"}
          confirmLabel={modal === "add" ? "Add" : "Save"}
          confirmDisabled={!form.productId || !form.lotNo.trim() || !form.expiryDate}
          onClose={close}
          onConfirm={() => (modal === "add" ? addLotAction(form) : updateLotAction(target!.id, form))}
        >
          <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field">
              <label>Product</label>
              <select className="input" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Lot number (as printed on the carton)</label>
              <input className="input" value={form.lotNo} onChange={(e) => setForm((f) => ({ ...f, lotNo: e.target.value }))} />
            </div>
            <div className="field">
              <label>Expiry date</label>
              <input className="input" type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "delete" && target && (
        <Modal title="Delete Lot" confirmLabel="Delete" onClose={close} onConfirm={() => deleteLotAction(target.id)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Remove lot <strong>{target.lot_no}</strong>? A lot already used in stock records can&apos;t be deleted.
            </p>
          </div>
        </Modal>
      )}

      {modal === "csv" && (
        <CsvImportModal<LotInput>
          title="Upload Lots CSV"
          intro="One row per lot. Product can be left out while there is only one product."
          fields={CSV_FIELDS}
          previewHeaders={["Lot number", "Expiry", "Product"]}
          templateCsv={"lot_no,expiry_date,product\nLOT-0001,2027-06-30,RUTF paste 92 g sachet\n"}
          templateName="lots-template.csv"
          validate={validateCsv}
          upload={bulkAddLotsAction}
          onClose={close}
        />
      )}
    </>
  );
}
