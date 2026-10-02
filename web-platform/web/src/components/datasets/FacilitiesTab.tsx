"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { tagBg } from "@/lib/constants";
import type { Database, FacilityType } from "@/lib/types/database";
import {
  addFacilityAction,
  approveFacilityAction,
  bulkUpsertFacilitiesAction,
  deleteFacilityAction,
  listFacilityIndexAction,
  rejectFacilityAction,
  updateFacilityAction,
  type FacilityInput,
} from "@/lib/actions/referenceData";
import { CsvImportModal, type CsvField, type CsvRowResult } from "./CsvImportModal";
import { StatusBadge, STATUS_FILTER_OPTIONS, Pager } from "./shared";

type Facility = Database["public"]["Tables"]["facilities"]["Row"];
type NamedRef = { id: string; name: string };
export type Store = { id: string; name: string; facility_type: FacilityType; lga_id: string };
export type FacilityFilters = { search: string; status: string; lga: string; type: string; otp: string; flagged: string };

export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = {
  state_store: "State store",
  lga_store: "LGA store",
  health_facility: "Health facility",
};
const TYPE_COLOR: Record<FacilityType, string> = {
  state_store: "var(--color-accent-800)",
  lga_store: "var(--color-accent-600)",
  health_facility: "var(--color-neutral-700)",
};
const FLAG_LABEL: Record<string, string> = {
  outside_boundaries: "Coordinates fall outside every known LGA",
  outside_declared_lga: "Coordinates fall in a different LGA",
  outside_declared_ward: "Coordinates fall in a different ward",
};
const SUPPLIER_TYPE: Record<FacilityType, FacilityType | null> = {
  state_store: null,
  lga_store: "state_store",
  health_facility: "lga_store",
};

type Form = {
  facilityType: FacilityType;
  name: string;
  lgaId: string;
  wardId: string;
  lat: string;
  lng: string;
  nationalCode: string;
  isOtpSite: boolean;
  isHardToReach: boolean;
  isActive: boolean;
  suppliedById: string;
};
const EMPTY_FORM: Form = {
  facilityType: "health_facility", name: "", lgaId: "", wardId: "", lat: "", lng: "", nationalCode: "",
  isOtpSite: false, isHardToReach: false, isActive: true, suppliedById: "",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
function yesNo(s: string): boolean | undefined {
  if (/^(true|yes|y|1)$/i.test(s)) return true;
  if (/^(false|no|n|0)$/i.test(s)) return false;
  return undefined;
}

export function FacilitiesTab({
  rows,
  total,
  page,
  totalPages,
  filters,
  lgas,
  wardsByLga,
  stores,
  isSuperAdmin,
  currentUserId,
}: {
  rows: Facility[];
  total: number;
  page: number;
  totalPages: number;
  filters: FacilityFilters;
  lgas: NamedRef[];
  wardsByLga: Record<string, NamedRef[]>;
  stores: Store[];
  isSuperAdmin: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<"add" | "edit" | "delete" | "approve" | "reject" | "csv" | null>(null);
  const [target, setTarget] = useState<Facility | null>(null);
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Form>(EMPTY_FORM);

  const lgaName = useMemo(() => Object.fromEntries(lgas.map((l) => [l.id, l.name])), [lgas]);
  const wardName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const wards of Object.values(wardsByLga)) for (const w of wards) m[w.id] = w.name;
    return m;
  }, [wardsByLga]);
  const storeName = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s.name])), [stores]);

  function hrefWith(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return `/data-sets?${params.toString()}`;
  }

  function closeModal() {
    setModal(null);
    setTarget(null);
    setNote("");
    setForm(EMPTY_FORM);
  }
  function openEdit(row: Facility) {
    setTarget(row);
    setForm({
      facilityType: row.facility_type,
      name: row.name,
      lgaId: row.lga_id,
      wardId: row.ward_id ?? "",
      lat: row.lat?.toString() ?? "",
      lng: row.lng?.toString() ?? "",
      nationalCode: row.national_code ?? "",
      isOtpSite: row.is_otp_site,
      isHardToReach: row.is_hard_to_reach,
      isActive: row.is_active,
      suppliedById: row.supplied_by_facility_id ?? "",
    });
    setModal("edit");
  }

  function formInput(): FacilityInput {
    return {
      facilityType: form.facilityType,
      name: form.name,
      lgaId: form.lgaId,
      wardId: form.wardId || null,
      lat: form.lat.trim() ? Number(form.lat) : null,
      lng: form.lng.trim() ? Number(form.lng) : null,
      nationalCode: form.nationalCode || null,
      isOtpSite: form.isOtpSite,
      isHardToReach: form.isHardToReach,
      isActive: form.isActive,
      suppliedById: form.suppliedById || null,
    };
  }

  // Suppliers one level up; for a health facility, LGA stores in its own LGA come first.
  const supplierOptions = useMemo(() => {
    const type = SUPPLIER_TYPE[form.facilityType];
    if (!type) return [];
    return stores
      .filter((s) => s.facility_type === type && s.id !== target?.id)
      .sort((a, b) => Number(b.lga_id === form.lgaId) - Number(a.lga_id === form.lgaId) || a.name.localeCompare(b.name));
  }, [stores, form.facilityType, form.lgaId, target]);

  // ── CSV upload ────────────────────────────────────────────────────────────────────────────────
  const [index, setIndex] = useState<{ byCode: Map<string, string>; byNameLga: Map<string, string> } | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  async function openCsv() {
    setModal("csv");
    if (index) return;
    const res = await listFacilityIndexAction();
    if (res.error || !res.rows) return setIndexError(res.error ?? "Couldn't load the facility list.");
    const byCode = new Map<string, string>();
    const byNameLga = new Map<string, string>();
    for (const r of res.rows) {
      if (r.national_code) byCode.set(norm(r.national_code), r.id);
      byNameLga.set(`${r.lga_id}|${norm(r.name)}`, r.id);
    }
    setIndex({ byCode, byNameLga });
  }

  const lgaByName = useMemo(() => new Map(lgas.map((l) => [norm(l.name), l.id])), [lgas]);
  const storeByName = useMemo(() => new Map(stores.map((s) => [norm(s.name), s])), [stores]);

  type CsvValue = Parameters<typeof bulkUpsertFacilitiesAction>[0][number];
  const validateCsv = useCallback(
    (r: Record<string, string>, seen: Set<string>): CsvRowResult<CsvValue> => {
      const cells = [r.national_code, r.name, r.lga, r.facility_type, r.is_otp_site, r.supplied_by];
      if (!index) return { cells, error: "Facility list still loading" };
      const lgaId = lgaByName.get(norm(r.lga));
      if (!lgaId) return { cells, error: `Unknown LGA "${r.lga}"` };
      const existingId = (r.national_code && index.byCode.get(norm(r.national_code))) || index.byNameLga.get(`${lgaId}|${norm(r.name)}`);
      const key = existingId ?? `${lgaId}|${norm(r.name)}`;
      if (seen.has(key)) return { cells, error: "Duplicate row in file" };
      seen.add(key);

      const isOtpSite = yesNo(r.is_otp_site);
      const isHardToReach = yesNo(r.is_hard_to_reach);
      if (r.is_otp_site && isOtpSite === undefined) return { cells, error: `OTP site must be yes/no, got "${r.is_otp_site}"` };
      if (r.is_hard_to_reach && isHardToReach === undefined) return { cells, error: `Hard-to-reach must be yes/no, got "${r.is_hard_to_reach}"` };
      const lat = r.lat ? Number(r.lat) : null;
      const lng = r.lng ? Number(r.lng) : null;
      if ((r.lat && !Number.isFinite(lat)) || (r.lng && !Number.isFinite(lng))) return { cells, error: "Latitude/longitude must be numbers" };
      let suppliedById: string | null | undefined = undefined;
      if (r.supplied_by) {
        const store = storeByName.get(norm(r.supplied_by));
        if (!store) return { cells, error: `Unknown supplying store "${r.supplied_by}"` };
        suppliedById = store.id;
      }

      if (existingId) {
        return {
          cells: [...cells.slice(0, 5), r.supplied_by],
          error: null,
          value: {
            id: existingId,
            isOtpSite,
            isHardToReach,
            suppliedById,
            ...(lat !== null && lng !== null ? { lat, lng } : {}),
          },
        };
      }
      const type = (r.facility_type ? norm(r.facility_type).replace(/[\s-]+/g, "_") : "health_facility") as FacilityType;
      if (!(type in FACILITY_TYPE_LABEL)) return { cells, error: `Type must be state_store, lga_store or health_facility` };
      const wardId = r.ward ? (wardsByLga[lgaId] ?? []).find((w) => norm(w.name) === norm(r.ward))?.id ?? null : null;
      return {
        cells,
        error: null,
        value: {
          facilityType: type,
          name: r.name,
          lgaId,
          wardId,
          lat,
          lng,
          nationalCode: r.national_code || null,
          isOtpSite: isOtpSite ?? false,
          isHardToReach: isHardToReach ?? false,
          isActive: true,
          suppliedById: suppliedById ?? null,
        },
      };
    },
    [index, lgaByName, storeByName, wardsByLga],
  );

  const csvFields: CsvField[] = useMemo(
    () => [
      { key: "national_code", label: "National code / globalid", keywords: ["globalid", "national", "code"] },
      { key: "name", label: "Facility name", required: true, keywords: ["name", "facility"] },
      { key: "lga", label: "LGA", required: true, keywords: ["lga", "local government"] },
      { key: "facility_type", label: "Type", keywords: ["type"] },
      { key: "is_otp_site", label: "OTP site (yes/no)", keywords: ["otp", "cmam"] },
      { key: "supplied_by", label: "Supplied by (store)", keywords: ["supplied", "supplier", "store"] },
      { key: "ward", label: "Ward", keywords: ["ward"] },
      { key: "lat", label: "Latitude", keywords: ["lat"] },
      { key: "lng", label: "Longitude", keywords: ["lng", "lon"] },
      { key: "is_hard_to_reach", label: "Hard to reach (yes/no)", keywords: ["hard", "remote"] },
    ],
    [],
  );

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const remountKey = searchParams.toString();

  return (
    <>
      <div className="filter-bar" key={remountKey} style={{ flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Search name or code…"
          defaultValue={filters.search}
          onChange={(e) => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
            const value = e.target.value;
            searchTimer.current = setTimeout(() => router.push(hrefWith({ search: value || null, page: null })), 350);
          }}
        />
        <select className="input" style={{ maxWidth: 170 }} defaultValue={filters.lga || "All"} onChange={(e) => router.push(hrefWith({ lga: e.target.value === "All" ? null : e.target.value, page: null }))}>
          <option value="All">All LGAs</option>
          {lgas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 160 }} defaultValue={filters.type || "All"} onChange={(e) => router.push(hrefWith({ type: e.target.value === "All" ? null : e.target.value, page: null }))}>
          <option value="All">All types</option>
          {(Object.keys(FACILITY_TYPE_LABEL) as FacilityType[]).map((t) => (
            <option key={t} value={t}>
              {FACILITY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 160 }} defaultValue={filters.status || "All"} onChange={(e) => router.push(hrefWith({ status: e.target.value === "All" ? null : e.target.value, page: null }))}>
          <option value="All">All status</option>
          {STATUS_FILTER_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={filters.otp === "1"} onChange={(e) => router.push(hrefWith({ otp: e.target.checked ? "1" : null, page: null }))} />
          OTP sites only
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={filters.flagged === "1"} onChange={(e) => router.push(hrefWith({ flagged: e.target.checked ? "1" : null, page: null }))} />
          Location flagged
        </label>
        {hasActiveFilters && (
          <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => router.push(hrefWith({ page: null, search: null, status: null, lga: null, type: null, otp: null, flagged: null }))}>
            <i className="ph ph-x-circle" />
            Clear Filters
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: -4 }}>
        <button className="btn btn-secondary" onClick={openCsv}>
          <i className="ph ph-upload-simple" /> Upload CSV
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(EMPTY_FORM);
            setModal("add");
          }}
        >
          <i className="ph ph-plus" /> Add Facility
        </button>
      </div>

      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Facility</th>
              <th>Type</th>
              <th>LGA / Ward</th>
              <th>Supplied by</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pd = row.pending_data as Record<string, unknown> | null;
              const canReview = isSuperAdmin && row.status.startsWith("pending_");
              const isOwnPending = row.submitted_by === currentUserId && row.status.startsWith("pending_");
              return (
                <tr key={row.id} style={row.is_active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      {row.name}
                      {row.is_otp_site && (
                        <span className="tag" style={{ marginLeft: 6, background: tagBg("var(--status-resolved)"), color: "var(--status-resolved)" }}>
                          OTP
                        </span>
                      )}
                      {row.is_hard_to_reach && (
                        <span className="tag" style={{ marginLeft: 6, background: tagBg("var(--priority-high)"), color: "var(--priority-high)" }}>
                          Hard to reach
                        </span>
                      )}
                      {!row.is_active && <span className="text-muted" style={{ marginLeft: 6, fontSize: 11 }}>(inactive)</span>}
                    </div>
                    {row.national_code && (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {row.national_code}
                      </div>
                    )}
                    {row.status === "pending_update" && pd && typeof pd.name === "string" && pd.name !== row.name && (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        proposed name: {pd.name}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="tag" style={{ background: tagBg(TYPE_COLOR[row.facility_type]), color: TYPE_COLOR[row.facility_type] }}>
                      {FACILITY_TYPE_LABEL[row.facility_type]}
                    </span>
                  </td>
                  <td>
                    {lgaName[row.lga_id] ?? "—"}
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {row.ward_id ? wardName[row.ward_id] : "No ward"}
                      {row.location_flag && (
                        <span title={FLAG_LABEL[row.location_flag] ?? row.location_flag} style={{ color: "var(--priority-high)", marginLeft: 6 }}>
                          <i className="ph-fill ph-warning" /> check location
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{row.supplied_by_facility_id ? storeName[row.supplied_by_facility_id] ?? "—" : "—"}</td>
                  <td>
                    <StatusBadge status={row.status} />
                    {row.status === "rejected" && row.review_note && (
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {row.review_note}
                      </div>
                    )}
                  </td>
                  <td className="table-actions">
                    {canReview && (
                      <>
                        <button className="btn btn-icon btn-ghost" title="Approve" onClick={() => { setTarget(row); setModal("approve"); }}>
                          <i className="ph ph-check-circle" style={{ color: "var(--status-resolved)" }} />
                        </button>
                        <button className="btn btn-icon btn-ghost" title="Reject" onClick={() => { setTarget(row); setModal("reject"); }}>
                          <i className="ph ph-x-circle" style={{ color: "var(--priority-critical)" }} />
                        </button>
                      </>
                    )}
                    {(isSuperAdmin || row.status === "approved" || isOwnPending) && (
                      <>
                        <button className="btn btn-icon btn-ghost" title="Edit" onClick={() => openEdit(row)}>
                          <i className="ph ph-pencil-simple" />
                        </button>
                        <button className="btn btn-icon btn-ghost" title="Delete" onClick={() => { setTarget(row); setModal("delete"); }}>
                          <i className="ph ph-trash" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  {total === 0 && !hasActiveFilters ? "No facilities yet." : "No facilities match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager total={total} page={page} totalPages={totalPages} hrefWith={hrefWith} noun="facilit" plural={["y", "ies"]} />
      </div>

      {(modal === "add" || modal === "edit") && (
        <Modal
          title={modal === "add" ? "Add Facility" : "Edit Facility"}
          confirmLabel={modal === "add" ? "Add" : "Save"}
          confirmDisabled={!form.name.trim() || !form.lgaId}
          onClose={closeModal}
          onConfirm={() => (modal === "add" ? addFacilityAction(formInput()) : updateFacilityAction(target!.id, formInput()))}
        >
          <div className="dialog-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {!isSuperAdmin && (
              <p className="text-muted" style={{ fontSize: 12, margin: 0, gridColumn: "1 / -1" }}>
                This will be submitted for Super Admin approval before it&apos;s published.
              </p>
            )}
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Type</label>
              <select
                className="input"
                value={form.facilityType}
                onChange={(e) => setForm((f) => ({ ...f, facilityType: e.target.value as FacilityType, suppliedById: "", isOtpSite: e.target.value === "health_facility" && f.isOtpSite }))}
              >
                {(Object.keys(FACILITY_TYPE_LABEL) as FacilityType[]).map((t) => (
                  <option key={t} value={t}>
                    {FACILITY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>National code</label>
              <input className="input" value={form.nationalCode} onChange={(e) => setForm((f) => ({ ...f, nationalCode: e.target.value }))} placeholder="Registry globalid" />
            </div>
            <div className="field">
              <label>LGA</label>
              <select className="input" value={form.lgaId} onChange={(e) => setForm((f) => ({ ...f, lgaId: e.target.value, wardId: "" }))}>
                <option value="">Select an LGA…</option>
                {lgas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ward</label>
              <select className="input" value={form.wardId} onChange={(e) => setForm((f) => ({ ...f, wardId: e.target.value }))} disabled={!form.lgaId}>
                <option value="">From coordinates</option>
                {(wardsByLga[form.lgaId] ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Latitude</label>
              <input className="input" inputMode="decimal" value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} placeholder="e.g. 12.9855" />
            </div>
            <div className="field">
              <label>Longitude</label>
              <input className="input" inputMode="decimal" value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} placeholder="e.g. 7.6171" />
            </div>
            {SUPPLIER_TYPE[form.facilityType] && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Supplied by ({FACILITY_TYPE_LABEL[SUPPLIER_TYPE[form.facilityType]!]})</label>
                <select className="input" value={form.suppliedById} onChange={(e) => setForm((f) => ({ ...f, suppliedById: e.target.value }))}>
                  <option value="">Not set</option>
                  {supplierOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
              {form.facilityType === "health_facility" && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={form.isOtpSite} onChange={(e) => setForm((f) => ({ ...f, isOtpSite: e.target.checked }))} />
                  OTP site
                </label>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={form.isHardToReach} onChange={(e) => setForm((f) => ({ ...f, isHardToReach: e.target.checked }))} />
                Hard to reach
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Active
              </label>
            </div>
            {target?.location_flag && modal === "edit" && (
              <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12, color: "var(--priority-high)" }}>
                <i className="ph-fill ph-warning" /> {FLAG_LABEL[target.location_flag] ?? target.location_flag}. Check the coordinates or the LGA/ward.
              </p>
            )}
          </div>
        </Modal>
      )}

      {modal === "delete" && target && (
        <Modal title="Delete Facility" confirmLabel="Delete" onClose={closeModal} onConfirm={() => deleteFacilityAction(target.id)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Remove <strong>{target.name}</strong>?{" "}
              {!isSuperAdmin && target.status === "approved" && "This will be submitted for Super Admin approval. "}
              To keep its history, edit it and untick <em>Active</em> instead.
            </p>
          </div>
        </Modal>
      )}

      {modal === "approve" && target && (
        <Modal title="Approve Change" confirmLabel="Approve" onClose={closeModal} onConfirm={() => approveFacilityAction(target.id, note)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Approve this change for <strong>{target.name}</strong>?
            </p>
            <div className="field">
              <label>Note (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}

      {modal === "reject" && target && (
        <Modal title="Reject Change" confirmLabel="Reject" onClose={closeModal} onConfirm={() => rejectFacilityAction(target.id, note)}>
          <div className="dialog-body">
            <p style={{ marginTop: 0 }}>
              Reject this change for <strong>{target.name}</strong>? The submitter will see your note.
            </p>
            <div className="field">
              <label>Reason</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required" />
            </div>
          </div>
        </Modal>
      )}

      {modal === "csv" && (
        <CsvImportModal<CsvValue>
          title="Upload Facilities CSV"
          intro={
            <>
              <p style={{ margin: "0 0 6px" }}>
                Rows that match an existing facility — by national code, or by name within the LGA — <strong>update</strong> it
                with whichever of OTP site, hard to reach, supplier and coordinates the file gives. Use this to load the
                programme&apos;s OTP site list. Other rows are <strong>added</strong> as new facilities.
              </p>
              {indexError ? (
                <span style={{ color: "var(--priority-critical)" }}>{indexError}</span>
              ) : (
                !index && <span className="text-muted">Loading the facility list…</span>
              )}
            </>
          }
          fields={csvFields}
          previewHeaders={["Code", "Name", "LGA", "Type", "OTP", "Supplied by"]}
          templateCsv={"national_code,name,lga,facility_type,is_otp_site,supplied_by,ward,lat,lng,is_hard_to_reach\n,Example Health Post,Bakori,health_facility,yes,Bakori LGA Nutrition Store (DUMMY),Bakori A,11.55,7.42,no\n"}
          templateName="facilities-template.csv"
          validate={validateCsv}
          upload={bulkUpsertFacilitiesAction}
          onClose={closeModal}
        />
      )}
    </>
  );
}
