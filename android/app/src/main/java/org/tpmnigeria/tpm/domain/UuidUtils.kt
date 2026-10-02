package org.tpmnigeria.tpm.domain

/**
 * Whether [id] is already a real Supabase UUID rather than an offline-asset placeholder id
 * (e.g. `"offline:<wardCode>:<name>"` — see ReferenceRepository's asset loaders, or a plain
 * ward/LGA/state code read straight from the bundled SQLite files). Used to skip a network
 * round-trip that would otherwise re-resolve an id we already know is server-native — see
 * SupabaseSyncApiService's resolve*Id functions and ReferenceRepository's ensureSettlementsLoaded/
 * ensureActivitySitesLoaded.
 */
fun isSupabaseUuid(id: String?): Boolean = id != null && id.length == 36 && id.contains("-")
