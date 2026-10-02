package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface ReferenceDao {
    @Query("SELECT * FROM ref_states ORDER BY name")
    fun observeStates(): Flow<List<StateRefEntity>>

    @Query("SELECT * FROM ref_lgas WHERE stateId = :stateId ORDER BY name")
    fun observeLgas(stateId: String): Flow<List<LgaRefEntity>>

    @Query("SELECT * FROM ref_wards WHERE lgaId = :lgaId ORDER BY name")
    fun observeWards(lgaId: String): Flow<List<WardRefEntity>>

    @Query("SELECT * FROM ref_categories ORDER BY sortOrder")
    fun observeCategories(): Flow<List<CategoryRefEntity>>

    @Query("SELECT * FROM ref_settlements WHERE wardId = :wardId ORDER BY name")
    fun observeSettlements(wardId: String): Flow<List<SettlementRefEntity>>

    @Query("SELECT * FROM ref_activity_sites WHERE wardId = :wardId ORDER BY name")
    fun observeActivitySites(wardId: String): Flow<List<ActivitySiteRefEntity>>

    @Query("SELECT * FROM ref_states WHERE id = :id")
    suspend fun getState(id: String): StateRefEntity?

    @Query("SELECT * FROM ref_lgas WHERE id = :id")
    suspend fun getLga(id: String): LgaRefEntity?

    @Query("SELECT * FROM ref_wards WHERE id = :id")
    suspend fun getWard(id: String): WardRefEntity?

    @Query("SELECT * FROM ref_categories WHERE id = :id")
    suspend fun getCategory(id: String): CategoryRefEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertStates(v: List<StateRefEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLgas(v: List<LgaRefEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWards(v: List<WardRefEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCategories(v: List<CategoryRefEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSettlements(v: List<SettlementRefEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertActivitySites(v: List<ActivitySiteRefEntity>)

    @Query("DELETE FROM ref_states")
    suspend fun clearStates()

    @Query("DELETE FROM ref_lgas")
    suspend fun clearLgas()

    @Query("DELETE FROM ref_categories")
    suspend fun clearCategories()

    @Query("SELECT * FROM ref_facilities WHERE id = :id")
    fun observeFacility(id: String): Flow<FacilityRefEntity?>

    @Query("SELECT * FROM ref_facilities WHERE id = :id")
    suspend fun getFacility(id: String): FacilityRefEntity?

    @Query("SELECT * FROM ref_facilities WHERE suppliedById = :facilityId ORDER BY name")
    fun observeFacilitiesSuppliedBy(facilityId: String): Flow<List<FacilityRefEntity>>

    @Query("SELECT COUNT(*) FROM ref_facilities")
    suspend fun countFacilities(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFacilities(v: List<FacilityRefEntity>)

    @Query("DELETE FROM ref_facilities")
    suspend fun clearFacilities()

    /** Whole-table swap in one transaction, so a reader never sees a half-refreshed list and a
     *  facility the user lost access to doesn't linger on the device. */
    @Transaction
    suspend fun replaceFacilities(v: List<FacilityRefEntity>) {
        clearFacilities()
        insertFacilities(v)
    }

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun markScopeLoaded(scope: LoadedScopeEntity)

    @Query("SELECT EXISTS(SELECT 1 FROM ref_loaded_scopes WHERE kind = :kind AND scopeKey = :scopeKey)")
    suspend fun isScopeLoaded(kind: String, scopeKey: String): Boolean
}
