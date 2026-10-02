package org.tpmnigeria.tpm.data

import android.content.Context
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import org.tpmnigeria.tpm.data.local.ActivitySiteRefEntity
import org.tpmnigeria.tpm.data.local.CategoryRefEntity
import org.tpmnigeria.tpm.data.local.LgaRefEntity
import org.tpmnigeria.tpm.data.local.LoadedScopeEntity
import org.tpmnigeria.tpm.data.local.ReferenceDao
import org.tpmnigeria.tpm.data.local.SettlementRefEntity
import org.tpmnigeria.tpm.data.local.StateRefEntity
import org.tpmnigeria.tpm.data.local.WardRefEntity
import org.tpmnigeria.tpm.data.remote.Supabase
import org.tpmnigeria.tpm.data.remote.dto.ActivitySiteDto
import org.tpmnigeria.tpm.data.remote.dto.CategoryDto
import org.tpmnigeria.tpm.data.remote.dto.LgaDto
import org.tpmnigeria.tpm.data.remote.dto.SettlementDto
import org.tpmnigeria.tpm.data.remote.dto.StateDto
import org.tpmnigeria.tpm.data.remote.dto.WardDto
import org.tpmnigeria.tpm.domain.isSupabaseUuid

/**
 * Location/category pick-lists, cached locally so the wizards keep working offline — see
 * ReferenceEntities.kt's kdoc. States/categories/lgas (all a few hundred rows at most) are
 * fetched in full on [refreshCoreReferenceData]; wards (~9,400 nationally) are fetched lazily per
 * LGA, and settlements/activity_sites lazily per Ward, the first time they're actually needed,
 * via [ensureWardsLoaded]/[ensureSettlementsLoaded]/[ensureActivitySitesLoaded].
 */
class ReferenceRepository(private val dao: ReferenceDao, context: Context) {
    private val postgrest get() = Supabase.client.postgrest
    private val assetHelper = AssetDatabaseHelper(context)

    fun observeStates(): Flow<List<StateRefEntity>> = dao.observeStates()
    fun observeLgas(stateId: String): Flow<List<LgaRefEntity>> = dao.observeLgas(stateId)
    fun observeWards(lgaId: String): Flow<List<WardRefEntity>> = dao.observeWards(lgaId)
    fun observeCategories(): Flow<List<CategoryRefEntity>> = dao.observeCategories()
    fun observeSettlements(wardId: String): Flow<List<SettlementRefEntity>> = dao.observeSettlements(wardId)
    fun observeActivitySites(wardId: String): Flow<List<ActivitySiteRefEntity>> = dao.observeActivitySites(wardId)

    suspend fun getState(id: String) = dao.getState(id)
    suspend fun getLga(id: String) = dao.getLga(id)
    suspend fun getCategory(id: String) = dao.getCategory(id)

    /** Call once after login (and periodically) — states/categories/lgas are small enough to
     *  always fetch in full rather than track partial-load state for them. */
    suspend fun refreshCoreReferenceData() = coroutineScope {
        // Categories still come from Supabase as there is no asset file for them — abbr (the
        // structured mobile_code's CAT3 segment, see IssueIdGenerator) comes along for free.
        val categoriesDeferred = async {
            try {
                postgrest.from("categories")
                    .select(columns = Columns.list("id", "name", "sort_order", "abbr")) { }
                    .decodeList<CategoryDto>()
            } catch (e: Exception) {
                null
            }
        }

        // Try to load States and LGAs from local assets first (Nigeria-wide data).
        val localStates = loadStatesFromAssets()
        val localLgas = loadLgasFromAssets()

        if (localStates.isNotEmpty()) {
            dao.clearStates()
            dao.insertStates(localStates)
        } else {
            // Fallback to Supabase for states if asset is missing or empty
            try {
                val states = postgrest.from("states")
                    .select(columns = Columns.list("id", "code", "name")) { }
                    .decodeList<StateDto>()
                dao.clearStates()
                dao.insertStates(states.map { StateRefEntity(it.id, it.code, it.name) })
            } catch (e: Exception) { /* ignore */ }
        }

        if (localLgas.isNotEmpty()) {
            // Asset-loaded LGAs carry no abbr (that column only exists in Supabase, added by web
            // migration 0026) — best-effort enrich by name so the structured mobile_code's LGA3
            // segment matches the web's real abbreviation once this device has connectivity.
            // Only 774 rows nationally — cheap to fetch in full rather than resolve one at a time.
            val enrichedLgas = runCatching {
                val abbrByName = postgrest.from("lgas")
                    .select(columns = Columns.list("id", "state_id", "name", "abbr")) { }
                    .decodeList<LgaDto>()
                    .associateBy { it.name }
                localLgas.map { it.copy(abbr = abbrByName[it.name]?.abbr) }
            }.getOrDefault(localLgas)
            dao.clearLgas()
            dao.insertLgas(enrichedLgas)
        } else {
            // Fallback to Supabase for LGAs
            try {
                val lgas = postgrest.from("lgas")
                    .select(columns = Columns.list("id", "state_id", "name", "abbr")) { }
                    .decodeList<LgaDto>()
                dao.clearLgas()
                dao.insertLgas(lgas.map { LgaRefEntity(it.id, it.state_id, it.name, it.abbr) })
            } catch (e: Exception) { /* ignore */ }
        }

        categoriesDeferred.await()?.let { categories ->
            dao.clearCategories()
            dao.insertCategories(categories.map { CategoryRefEntity(it.id, it.name, it.sort_order, it.abbr) })
        }
    }

    suspend fun ensureWardsLoaded(lgaId: String) {
        if (dao.isScopeLoaded("wards", lgaId)) return

        // Try local asset first
        val localWards = loadWardsFromAssets(lgaId)
        if (localWards.isNotEmpty()) {
            dao.insertWards(enrichWardAbbrs(lgaId, localWards))
            dao.markScopeLoaded(LoadedScopeEntity("wards", lgaId))
            return
        }

        // Fallback to Supabase
        try {
            val wards = postgrest.from("wards")
                .select(columns = Columns.list("id", "lga_id", "name", "abbr")) { filter { eq("lga_id", lgaId) } }
                .decodeList<WardDto>()
            dao.insertWards(wards.map { WardRefEntity(it.id, it.lga_id, it.name, it.abbr) })
            dao.markScopeLoaded(LoadedScopeEntity("wards", lgaId))
        } catch (e: Exception) {
            // Silently fail lazy-load; the UI's empty flow will stay empty, showing "No data found"
        }
    }

    /** Best-effort: resolves the real Supabase abbr (structured mobile_code's WARD3 segment) for
     *  each asset-loaded ward by matching wardcode/name against the resolved LGA's real wards —
     *  same signals [ensureSettlementsLoaded]/[ensureActivitySitesLoaded] already trust for ward
     *  UUID resolution. Falls back to leaving abbr null (→ "GEN" in IssueIdGenerator) when
     *  offline or the LGA/wards can't be resolved; never blocks the offline-first ward list
     *  itself, which is already fully populated from the asset by the time this runs. */
    private suspend fun enrichWardAbbrs(lgaId: String, localWards: List<WardRefEntity>): List<WardRefEntity> {
        val localLga = dao.getLga(lgaId) ?: return localWards
        return try {
            val remoteLgaId = postgrest.from("lgas")
                .select(columns = Columns.list("id")) { filter { eq("name", localLga.name) } }
                .decodeList<LgaDto>().firstOrNull()?.id ?: return localWards

            val remoteWards = postgrest.from("wards")
                .select(columns = Columns.list("id", "lga_id", "code", "name", "abbr")) { filter { eq("lga_id", remoteLgaId) } }
                .decodeList<WardDto>()
            val byCode = remoteWards.associateBy { it.code }
            val byName = remoteWards.associateBy { it.name }

            localWards.map { w -> w.copy(abbr = byCode[w.id]?.abbr ?: byName[w.name]?.abbr) }
        } catch (e: Exception) {
            localWards
        }
    }

    private suspend fun loadStatesFromAssets(): List<StateRefEntity> = withContext(Dispatchers.IO) {
        try {
            assetHelper.useDatabase("state.sqlite") { db ->
                val table = assetHelper.findTableName(db, listOf("vaccstates", "states", "ref_states", "state")) ?: return@useDatabase emptyList()
                val list = mutableListOf<StateRefEntity>()
                // Specifically select only needed columns to avoid issues with custom types (like MULTIPOLYGON in SpatiaLite)
                db.rawQuery("SELECT statecode, statename FROM $table", null).use { cursor ->
                    val idIdx = cursor.getColumnIndex("statecode")
                    val nameIdx = cursor.getColumnIndex("statename")
                    
                    if (idIdx == -1 || nameIdx == -1) {
                        android.util.Log.e("ReferenceRepository", "Required columns missing in state asset")
                        return@useDatabase emptyList()
                    }

                    while (cursor.moveToNext()) {
                        list.add(StateRefEntity(
                            id = cursor.getString(idIdx),
                            name = cursor.getString(nameIdx),
                            code = cursor.getString(idIdx)
                        ))
                    }
                }
                android.util.Log.d("ReferenceRepository", "Loaded ${list.size} states from assets")
                list
            }
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load states from assets", e)
            emptyList()
        }
    }

    private suspend fun loadLgasFromAssets(): List<LgaRefEntity> = withContext(Dispatchers.IO) {
        try {
            assetHelper.useDatabase("LGA.sqlite") { db ->
                val table = assetHelper.findTableName(db, listOf("vacclgas", "lgas", "ref_lgas", "lga")) ?: return@useDatabase emptyList()
                val list = mutableListOf<LgaRefEntity>()
                db.rawQuery("SELECT lgacode, lganame, statecode FROM $table", null).use { cursor ->
                    val idIdx = cursor.getColumnIndex("lgacode")
                    val nameIdx = cursor.getColumnIndex("lganame")
                    val stateIdIdx = cursor.getColumnIndex("statecode")
                    
                    if (idIdx == -1 || nameIdx == -1 || stateIdIdx == -1) {
                        android.util.Log.e("ReferenceRepository", "Required columns missing in LGA asset")
                        return@useDatabase emptyList()
                    }

                    while (cursor.moveToNext()) {
                        list.add(LgaRefEntity(
                            id = cursor.getString(idIdx),
                            name = cursor.getString(nameIdx),
                            stateId = cursor.getString(stateIdIdx)
                        ))
                    }
                }
                android.util.Log.d("ReferenceRepository", "Loaded ${list.size} LGAs from assets")
                list
            }
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load LGAs from assets", e)
            emptyList()
        }
    }

    private suspend fun loadWardsFromAssets(lgaId: String): List<WardRefEntity> = withContext(Dispatchers.IO) {
        try {
            assetHelper.useDatabase("Ward.sqlite") { db ->
                val table = assetHelper.findTableName(db, listOf("vaccwards", "wards", "ref_wards", "ward")) ?: return@useDatabase emptyList()
                val list = mutableListOf<WardRefEntity>()
                // Use lgacode for filtering as confirmed by schema
                db.rawQuery("SELECT wardcode, wardname FROM $table WHERE lgacode = ?", arrayOf(lgaId)).use { cursor ->
                    val idIdx = cursor.getColumnIndex("wardcode")
                    val nameIdx = cursor.getColumnIndex("wardname")
                    
                    if (idIdx == -1 || nameIdx == -1) {
                        android.util.Log.e("ReferenceRepository", "Required columns missing in Ward asset")
                        return@useDatabase emptyList()
                    }

                    while (cursor.moveToNext()) {
                        list.add(WardRefEntity(
                            id = cursor.getString(idIdx),
                            name = cursor.getString(nameIdx),
                            lgaId = lgaId
                        ))
                    }
                }
                android.util.Log.d("ReferenceRepository", "Loaded ${list.size} wards for LGA $lgaId from assets")
                list
            }
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load wards from assets", e)
            emptyList()
        }
    }

    /** Settlement.sqlite: same bundled-asset pattern as Ward.sqlite, keyed by wardcode — see
     *  DECISIONS.md #10 in the web project. The local `id` here is deliberately NOT a real Supabase UUID (there isn't one
     *  offline); it just needs to fail SupabaseSyncApiService.isUuid() so that at sync time
     *  resolveSettlementId falls through to its existing by-name+ward_id lookup against the real
     *  ward UUID, which correctly resolves the authoritative row regardless of what placeholder ID
     *  was used locally. Prefixed with wardCode since a settlement/site name is not globally
     *  unique across wards (common Nigerian place names repeat everywhere) but this is the Room
     *  primary key. */
    private suspend fun loadSettlementsFromAssets(wardCode: String): List<SettlementRefEntity> = withContext(Dispatchers.IO) {
        try {
            assetHelper.useDatabase("Settlement.sqlite") { db ->
                val table = assetHelper.findTableName(db, listOf("settlements", "vaccsettlements", "ref_settlements")) ?: return@useDatabase emptyList()
                val list = mutableListOf<SettlementRefEntity>()
                db.rawQuery("SELECT settlementname FROM $table WHERE wardcode = ?", arrayOf(wardCode)).use { cursor ->
                    val nameIdx = cursor.getColumnIndex("settlementname")
                    if (nameIdx == -1) return@useDatabase emptyList()
                    while (cursor.moveToNext()) {
                        val name = cursor.getString(nameIdx)
                        list.add(SettlementRefEntity(id = "offline:$wardCode:$name", wardId = wardCode, name = name))
                    }
                }
                list
            }
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load settlements from assets for $wardCode", e)
            emptyList()
        }
    }

    private suspend fun loadActivitySitesFromAssets(wardCode: String): List<ActivitySiteRefEntity> = withContext(Dispatchers.IO) {
        try {
            assetHelper.useDatabase("ActivitySite.sqlite") { db ->
                val table = assetHelper.findTableName(db, listOf("activitysites", "vaccactivitysites", "ref_activity_sites")) ?: return@useDatabase emptyList()
                val list = mutableListOf<ActivitySiteRefEntity>()
                db.rawQuery("SELECT activitysitename FROM $table WHERE wardcode = ?", arrayOf(wardCode)).use { cursor ->
                    val nameIdx = cursor.getColumnIndex("activitysitename")
                    if (nameIdx == -1) return@useDatabase emptyList()
                    while (cursor.moveToNext()) {
                        val name = cursor.getString(nameIdx)
                        list.add(ActivitySiteRefEntity(id = "offline:$wardCode:$name", wardId = wardCode, name = name))
                    }
                }
                list
            }
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load activity sites from assets for $wardCode", e)
            emptyList()
        }
    }

    suspend fun ensureSettlementsLoaded(wardId: String) {
        if (dao.isScopeLoaded("settlements", wardId)) return

        // Bundled asset first — works fully offline, no prior online visit to this Ward needed.
        val localSettlements = loadSettlementsFromAssets(wardId)
        if (localSettlements.isNotEmpty()) {
            dao.insertSettlements(localSettlements)
            dao.markScopeLoaded(LoadedScopeEntity("settlements", wardId))
            return
        }

        try {
            val localWard = dao.getWard(wardId) ?: return
            val localLga = dao.getLga(localWard.lgaId)

            // wardId is already the real Supabase UUID (e.g. this ward came from
            // ensureWardsLoaded's network fallback rather than the bundled asset) — skip the
            // by-code/name resolution round-trip entirely, we already have what it would return.
            val remoteWardId = if (isSupabaseUuid(wardId)) {
                wardId
            } else {
                postgrest.from("wards")
                    .select {
                        filter {
                            or {
                                eq("code", wardId) // wardcode from local asset
                                eq("name", localWard.name) // name from local asset
                            }
                        }
                    }
                    .decodeList<WardDto>().firstOrNull()?.id
            }

            val settlements = if (remoteWardId != null) {
                postgrest.from("settlements")
                    .select(columns = Columns.list("id", "ward_id", "settlementname")) {
                        filter { eq("ward_id", remoteWardId) }
                    }
                    .decodeList<SettlementDto>()
            } else {
                emptyList()
            }
            
            if (settlements.isNotEmpty()) {
                dao.insertSettlements(settlements.map { SettlementRefEntity(it.id, wardId, it.settlementname) })
            } else {
                // Fallback: match by lganame and statename (denormalized columns in settlements table)
                if (localLga != null) {
                    val localState = dao.getState(localLga.stateId)
                    if (localState != null) {
                        val flatSettlements = postgrest.from("settlements")
                            .select(columns = Columns.list("id", "ward_id", "settlementname")) {
                                filter {
                                    eq("lganame", localLga.name)
                                    eq("statename", localState.name)
                                }
                            }
                            .decodeList<SettlementDto>()
                        
                        if (flatSettlements.isNotEmpty()) {
                            dao.insertSettlements(flatSettlements.map { SettlementRefEntity(it.id, wardId, it.settlementname) })
                        }
                    }
                }
            }
            dao.markScopeLoaded(LoadedScopeEntity("settlements", wardId))
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load settlements for $wardId", e)
        }
    }

    suspend fun ensureActivitySitesLoaded(wardId: String) {
        if (dao.isScopeLoaded("activity_sites", wardId)) return

        val localSites = loadActivitySitesFromAssets(wardId)
        if (localSites.isNotEmpty()) {
            dao.insertActivitySites(localSites)
            dao.markScopeLoaded(LoadedScopeEntity("activity_sites", wardId))
            return
        }

        try {
            val localWard = dao.getWard(wardId) ?: return
            val localLga = dao.getLga(localWard.lgaId)

            // Same isSupabaseUuid short-circuit as ensureSettlementsLoaded — see its comment.
            val remoteWardId = if (isSupabaseUuid(wardId)) {
                wardId
            } else {
                postgrest.from("wards")
                    .select {
                        filter {
                            or {
                                eq("code", wardId)
                                eq("name", localWard.name)
                            }
                        }
                    }
                    .decodeList<WardDto>().firstOrNull()?.id
            }

            val sites = if (remoteWardId != null) {
                postgrest.from("activity_sites")
                    .select(columns = Columns.list("id", "ward_id", "activitysitename")) {
                        filter { eq("ward_id", remoteWardId) }
                    }
                    .decodeList<ActivitySiteDto>()
            } else {
                emptyList()
            }
            
            if (sites.isNotEmpty()) {
                dao.insertActivitySites(sites.map { ActivitySiteRefEntity(it.id, wardId, it.activitysitename) })
            } else {
                if (localLga != null) {
                    val localState = dao.getState(localLga.stateId)
                    if (localState != null) {
                        val flatSites = postgrest.from("activity_sites")
                            .select(columns = Columns.list("id", "ward_id", "activitysitename")) {
                                filter {
                                    eq("lganame", localLga.name)
                                    eq("statename", localState.name)
                                }
                            }
                            .decodeList<ActivitySiteDto>()
                        
                        if (flatSites.isNotEmpty()) {
                            dao.insertActivitySites(flatSites.map { ActivitySiteRefEntity(it.id, wardId, it.activitysitename) })
                        }
                    }
                }
            }
            dao.markScopeLoaded(LoadedScopeEntity("activity_sites", wardId))
        } catch (e: Exception) {
            android.util.Log.e("ReferenceRepository", "Failed to load activity sites for $wardId", e)
        }
    }
}
