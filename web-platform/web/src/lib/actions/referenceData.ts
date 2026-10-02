"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/dal";
import { canManageDatasets } from "@/lib/rbac";
import type { Database, FacilityType } from "@/lib/types/database";

// RUTF reference data (migration 0100) behind the Data Sets screen. RLS and the 0015 workflow
// trigger are the real guards: a Project Admin's facility add/edit/delete becomes a pending
// proposal server-side, and products/protocol rules/thresholds reject anyone but Super Admin.
// The role checks here only return a clear message before the round trip.

type ActionResult = { error?: string };
type BulkResult = { error?: string; inserted?: number; updated?: number };

const BULK_MAX_ROWS = 3000;
const BULK_CHUNK_SIZE = 500;

function afterChange() {
  revalidatePath("/data-sets");
}

async function requireDatasetManager() {
  const profile = await getCurrentProfile();
  return canManageDatasets(profile.role) ? profile : null;
}

async function requireSuperAdmin() {
  const profile = await getCurrentProfile();
  return profile.role === "super_admin" ? profile : null;
}

/** Project for new rows: the caller's own, else — for a Super Admin with no project — the only
 *  project when there is exactly one (the Katsina pilot), so rows stay visible to project users. */
async function defaultProjectId(supabase: Awaited<ReturnType<typeof createClient>>, ownProjectId: string | null) {
  if (ownProjectId) return ownProjectId;
  const { data } = await supabase.from("projects").select("id").limit(2);
  return data?.length === 1 ? data[0].id : null;
}

// ── Facilities ─────────────────────────────────────────────────────────────────────────────────

export type FacilityInput = {
  facilityType: FacilityType;
  name: string;
  lgaId: string;
  wardId: string | null;
  lat: number | null;
  lng: number | null;
  nationalCode: string | null;
  isOtpSite: boolean;
  isHardToReach: boolean;
  isActive: boolean;
  suppliedById: string | null;
};

function facilityRow(input: FacilityInput) {
  return {
    facility_type: input.facilityType,
    name: input.name.trim(),
    lga_id: input.lgaId,
    ward_id: input.wardId || null,
    lat: input.lat,
    lng: input.lng,
    geocode_source: input.lat !== null && input.lng !== null ? ("manual" as const) : null,
    national_code: input.nationalCode?.trim() || null,
    is_otp_site: input.facilityType === "health_facility" && input.isOtpSite,
    is_hard_to_reach: input.isHardToReach,
    is_active: input.isActive,
    supplied_by_facility_id: input.facilityType === "state_store" ? null : input.suppliedById || null,
  };
}

function validateFacility(input: FacilityInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!input.lgaId) return "LGA is required.";
  if ((input.lat === null) !== (input.lng === null)) return "Enter both latitude and longitude, or neither.";
  if (input.lat !== null && (input.lat < -90 || input.lat > 90 || input.lng! < -180 || input.lng! > 180)) return "Coordinates are out of range.";
  return null;
}

export async function addFacilityAction(input: FacilityInput): Promise<ActionResult> {
  const profile = await requireDatasetManager();
  if (!profile) return { error: "Not authorized." };
  const invalid = validateFacility(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  // Project Admin rows get their own project from the workflow trigger regardless.
  const projectId = await defaultProjectId(supabase, profile.project_id);
  const { error } = await supabase.from("facilities").insert({ ...facilityRow(input), project_id: projectId });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function updateFacilityAction(id: string, input: FacilityInput): Promise<ActionResult> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  const invalid = validateFacility(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.from("facilities").update(facilityRow(input)).eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function deleteFacilityAction(id: string): Promise<ActionResult> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase.from("facilities").delete().eq("id", id);
  if (error) {
    // A facility that supplies others or has users assigned can't be removed — deactivate instead.
    if (error.code === "23503") return { error: "This facility is still referenced (it supplies other facilities or has users). Mark it inactive instead." };
    return { error: error.message };
  }
  afterChange();
  return {};
}

export async function approveFacilityAction(id: string, note: string): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may approve." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_facility", { p_id: id, p_note: note || null });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function rejectFacilityAction(id: string, note: string): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may reject." };
  if (!note.trim()) return { error: "A note explaining the rejection is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_facility", { p_id: id, p_note: note });
  if (error) return { error: error.message };
  afterChange();
  return {};
}

/** Lightweight index of every facility the caller can see, for CSV matching in the browser. */
export async function listFacilityIndexAction(): Promise<{ error?: string; rows?: { id: string; name: string; lga_id: string; national_code: string | null }[] }> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  const supabase = await createClient();
  const rows: { id: string; name: string; lga_id: string; national_code: string | null }[] = [];
  // PostgREST caps one request at 1,000 rows — page through.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("facilities").select("id, name, lga_id, national_code").neq("status", "rejected").order("id").range(from, from + 999);
    if (error) return { error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows };
}

/**
 * CSV upload. A row with `id` updates that facility (only the fields the CSV supplied) — this is
 * how the programme's OTP site list flips is_otp_site on registry facilities (brief §12, still
 * open item 1). A row without `id` is a new facility.
 */
export async function bulkUpsertFacilitiesAction(
  rows: ({ id: string } & Partial<FacilityInput> | { id?: undefined } & FacilityInput)[],
): Promise<BulkResult> {
  const profile = await requireDatasetManager();
  if (!profile) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to upload." };
  if (rows.length > BULK_MAX_ROWS) return { error: `Up to ${BULK_MAX_ROWS} rows at a time.` };

  const supabase = await createClient();
  const inserts = rows.filter((r) => !r.id) as FacilityInput[];
  const updates = rows.filter((r) => r.id) as ({ id: string } & Partial<FacilityInput>)[];

  for (const r of inserts) {
    const invalid = validateFacility(r);
    if (invalid) return { error: `${r.name || "A new facility"}: ${invalid}` };
  }
  const projectId = await defaultProjectId(supabase, profile.project_id);
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += BULK_CHUNK_SIZE) {
    const chunk = inserts.slice(i, i + BULK_CHUNK_SIZE).map((r) => ({ ...facilityRow(r), project_id: projectId }));
    const { error } = await supabase.from("facilities").insert(chunk);
    if (error) return { error: `New facilities failed at row ${i + 1}: ${error.message}`, inserted };
    inserted += chunk.length;
  }

  let updated = 0;
  for (const r of updates) {
    const patch: Database["public"]["Tables"]["facilities"]["Update"] = {};
    if (r.name !== undefined) patch.name = r.name.trim();
    if (r.isOtpSite !== undefined) patch.is_otp_site = r.isOtpSite;
    if (r.isHardToReach !== undefined) patch.is_hard_to_reach = r.isHardToReach;
    if (r.isActive !== undefined) patch.is_active = r.isActive;
    if (r.suppliedById !== undefined) patch.supplied_by_facility_id = r.suppliedById;
    if (r.lat !== undefined && r.lng !== undefined && r.lat !== null && r.lng !== null) {
      patch.lat = r.lat;
      patch.lng = r.lng;
      patch.geocode_source = "manual";
    }
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase.from("facilities").update(patch).eq("id", r.id);
    if (error) return { error: `Update failed for ${r.name ?? r.id}: ${error.message}`, inserted, updated };
    updated++;
  }

  afterChange();
  return { inserted, updated };
}

// ── Lots ───────────────────────────────────────────────────────────────────────────────────────

export type LotInput = { productId: string; lotNo: string; expiryDate: string };

function validateLot(input: LotInput): string | null {
  if (!input.productId) return "Product is required.";
  if (!input.lotNo.trim()) return "Lot number is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) return "Expiry date must be YYYY-MM-DD.";
  return null;
}

export async function addLotAction(input: LotInput): Promise<ActionResult> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  const invalid = validateLot(input);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.from("product_lots").insert({ product_id: input.productId, lot_no: input.lotNo.trim(), expiry_date: input.expiryDate });
  if (error) return { error: error.code === "23505" ? "That lot number already exists for this product." : error.message };
  afterChange();
  return {};
}

export async function updateLotAction(id: string, input: LotInput): Promise<ActionResult> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  const invalid = validateLot(input);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.from("product_lots").update({ product_id: input.productId, lot_no: input.lotNo.trim(), expiry_date: input.expiryDate }).eq("id", id);
  if (error) return { error: error.code === "23505" ? "That lot number already exists for this product." : error.message };
  afterChange();
  return {};
}

export async function deleteLotAction(id: string): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may delete lots." };
  const supabase = await createClient();
  const { error } = await supabase.from("product_lots").delete().eq("id", id);
  if (error) return { error: error.code === "23503" ? "This lot is already used in stock records and can't be deleted." : error.message };
  afterChange();
  return {};
}

export async function bulkAddLotsAction(rows: LotInput[]): Promise<BulkResult> {
  if (!(await requireDatasetManager())) return { error: "Not authorized." };
  if (rows.length === 0) return { error: "No rows to upload." };
  if (rows.length > BULK_MAX_ROWS) return { error: `Up to ${BULK_MAX_ROWS} rows at a time.` };
  for (const r of rows) {
    const invalid = validateLot(r);
    if (invalid) return { error: `${r.lotNo || "A row"}: ${invalid}` };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_lots")
    .insert(rows.map((r) => ({ product_id: r.productId, lot_no: r.lotNo.trim(), expiry_date: r.expiryDate })));
  if (error) return { error: error.code === "23505" ? "One or more lot numbers already exist for this product." : error.message };
  afterChange();
  return { inserted: rows.length };
}

// ── Protocol rules (Super Admin only — brief §12.3 sign-off values) ─────────────────────────────

export type ProtocolRuleInput = {
  protocolVersion: string;
  weightMinKg: number;
  weightMaxKg: number;
  sachetsPerWeek: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

function protocolRow(input: ProtocolRuleInput) {
  return {
    protocol_version: input.protocolVersion.trim(),
    weight_min_kg: input.weightMinKg,
    weight_max_kg: input.weightMaxKg,
    sachets_per_week: input.sachetsPerWeek,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo || null,
  };
}

function validateProtocol(input: ProtocolRuleInput): string | null {
  if (!input.protocolVersion.trim()) return "Protocol version is required.";
  if (![input.weightMinKg, input.weightMaxKg, input.sachetsPerWeek].every(Number.isFinite)) return "Weights and sachets must be numbers.";
  if (input.weightMaxKg < input.weightMinKg) return "Maximum weight must be at least the minimum.";
  if (input.sachetsPerWeek <= 0) return "Sachets per week must be above zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return "Effective-from must be YYYY-MM-DD.";
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) return "Effective-to must be on or after effective-from.";
  return null;
}

export async function saveProtocolRuleAction(id: string | null, input: ProtocolRuleInput): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may change dosing rules." };
  const invalid = validateProtocol(input);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("protocol_rules").update(protocolRow(input)).eq("id", id)
    : await supabase.from("protocol_rules").insert(protocolRow(input));
  if (error) return { error: error.code === "23505" ? "This protocol version already has a band starting at that weight." : error.message };
  afterChange();
  return {};
}

export async function deleteProtocolRuleAction(id: string): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may change dosing rules." };
  const supabase = await createClient();
  const { error } = await supabase.from("protocol_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  afterChange();
  return {};
}

export async function bulkAddProtocolRulesAction(rows: ProtocolRuleInput[]): Promise<BulkResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may change dosing rules." };
  if (rows.length === 0) return { error: "No rows to upload." };
  for (const r of rows) {
    const invalid = validateProtocol(r);
    if (invalid) return { error: `${r.protocolVersion} ${r.weightMinKg} kg: ${invalid}` };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("protocol_rules").insert(rows.map(protocolRow));
  if (error) return { error: error.code === "23505" ? "One or more bands already exist for that protocol version." : error.message };
  afterChange();
  return { inserted: rows.length };
}

// ── Thresholds (Super Admin only — brief §12.4) ────────────────────────────────────────────────

export async function updateThresholdAction(projectId: string, key: string, value: number, note: string): Promise<ActionResult> {
  if (!(await requireSuperAdmin())) return { error: "Only Super Admin may change thresholds." };
  if (!Number.isFinite(value)) return { error: "Value must be a number." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rutf_thresholds")
    .update({ value, note: note.trim() || null })
    .eq("project_id", projectId)
    .eq("key", key);
  if (error) return { error: error.message };
  afterChange();
  return {};
}
