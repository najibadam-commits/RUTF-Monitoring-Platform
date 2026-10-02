package org.tpmnigeria.tpm.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Local cache of the real Supabase reference/lookup tables (states/lgas/wards/categories/
 * settlements/activity_sites) — the Location and Issue Details wizard steps read from these,
 * not the network directly, so they keep working offline. States/categories/lgas are small
 * enough to cache in full on login; wards (~9,400 nationally) and settlements/activity_sites are
 * cached lazily per LGA/Ward the first time they're actually needed — see
 * ReferenceRepository.ensureWardsLoaded/ensureSettlementsLoaded/ensureActivitySitesLoaded.
 *
 * Settlements and Activity Sites are independent siblings tied directly to a Ward — not a
 * Settlement -> Activity Site chain — each with a real stable `id` (the actual Supabase row id,
 * not a composite name key). See supabase/migrations/0019_ward_linked_settlements_activity_sites.sql
 * and DECISIONS.md #8.
 */
@Entity(tableName = "ref_states")
data class StateRefEntity(
    @PrimaryKey val id: String,
    val code: String?,
    val name: String,
)

@Entity(tableName = "ref_lgas")
data class LgaRefEntity(
    @PrimaryKey val id: String,
    val stateId: String,
    val name: String,
    /** 3-letter code for the structured mobile_code's LGA3 segment — see IssueIdGenerator and
     *  web migration 0026. Null until enriched from Supabase (ReferenceRepository's asset-loaded
     *  rows don't carry it); IssueIdGenerator falls back to "GEN" when null, same as the server. */
    val abbr: String? = null,
)

@Entity(tableName = "ref_wards")
data class WardRefEntity(
    @PrimaryKey val id: String,
    val lgaId: String,
    val name: String,
    /** See LgaRefEntity.abbr's kdoc — same story, for the ID's WARD3 segment. */
    val abbr: String? = null,
)

@Entity(tableName = "ref_categories")
data class CategoryRefEntity(
    @PrimaryKey val id: String,
    val name: String,
    val sortOrder: Int,
    /** See LgaRefEntity.abbr's kdoc — same story, for the ID's CAT3 segment. Categories are
     *  always Supabase-sourced (no bundled asset), so this is populated whenever the device has
     *  been online at least once, unlike the LGA/ward abbr which may lag behind their asset load. */
    val abbr: String? = null,
)

@Entity(tableName = "ref_settlements")
data class SettlementRefEntity(
    @PrimaryKey val id: String,
    val wardId: String,
    val name: String,
)

@Entity(tableName = "ref_activity_sites")
data class ActivitySiteRefEntity(
    @PrimaryKey val id: String,
    val wardId: String,
    val name: String,
)

/**
 * Tracks which scopes' wards/settlements/activity_sites have already been fetched and cached, so
 * ensureXLoaded() doesn't re-hit the network every time the same Ward is picked. [scopeKey] is the
 * LGA id for wards, or the Ward id for settlements/activity_sites — all real FKs now (see
 * supabase/migrations/0019_ward_linked_settlements_activity_sites.sql).
 */
@Entity(tableName = "ref_loaded_scopes", primaryKeys = ["kind", "scopeKey"])
data class LoadedScopeEntity(
    val kind: String, // "wards" | "settlements" | "activity_sites"
    val scopeKey: String,
)
