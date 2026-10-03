package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface StockDao {
    @Query("SELECT * FROM ref_products ORDER BY name")
    fun observeProducts(): Flow<List<ProductRefEntity>>

    @Query("SELECT * FROM ref_lots ORDER BY expiryDate, lotNo")
    fun observeLots(): Flow<List<LotRefEntity>>

    @Query("SELECT * FROM ref_stock_balances WHERE facilityId = :facilityId")
    fun observeBalances(facilityId: String): Flow<List<StockBalanceEntity>>

    @Query("SELECT * FROM ref_incoming_transfers WHERE toFacilityId = :facilityId ORDER BY issuedDate")
    fun observeIncomingTransfers(facilityId: String): Flow<List<IncomingTransferEntity>>

    @Query("SELECT * FROM ref_incoming_transfer_lines WHERE transferId = :transferId ORDER BY lineNo")
    suspend fun getTransferLines(transferId: String): List<IncomingTransferLineEntity>

    @Query("SELECT EXISTS(SELECT 1 FROM ref_dispensing_days WHERE facilityId = :facilityId AND dispenseDate = :date)")
    suspend fun isDispensingDayRecorded(facilityId: String, date: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertProducts(v: List<ProductRefEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertLots(v: List<LotRefEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertBalances(v: List<StockBalanceEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertIncomingTransfers(v: List<IncomingTransferEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertTransferLines(v: List<IncomingTransferLineEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertDispensingDays(v: List<DispensingDayEntity>)

    @Query("DELETE FROM ref_products") suspend fun clearProducts()
    @Query("DELETE FROM ref_lots") suspend fun clearLots()
    @Query("DELETE FROM ref_stock_balances") suspend fun clearBalances()
    @Query("DELETE FROM ref_incoming_transfers") suspend fun clearIncomingTransfers()
    @Query("DELETE FROM ref_incoming_transfer_lines") suspend fun clearTransferLines()
    @Query("DELETE FROM ref_dispensing_days") suspend fun clearDispensingDays()

    // ── Supervision (web migration 0103) ────────────────────────────────────────────────────────

    /** The stores or OTP sites the signed-in supervisor covers, from the facility cache. */
    @Query("""
        SELECT f.* FROM ref_facilities f
        WHERE (:level = 'otp_sites' AND f.facilityType = 'health_facility' AND f.isOtpSite = 1
                 AND f.lgaId IN (SELECT lgaId FROM ref_supervisor_lgas))
           OR (:level = 'stores' AND (f.facilityType = 'state_store'
                 OR (f.facilityType = 'lga_store' AND f.lgaId IN (SELECT lgaId FROM ref_supervisor_lgas))))
        ORDER BY f.name
    """)
    fun observeSupervisedFacilities(level: String): Flow<List<FacilityRefEntity>>

    @Query("SELECT * FROM ref_otp_dispensing WHERE facilityId = :facilityId AND dispenseDate BETWEEN :from AND :to")
    suspend fun getOtpDispensing(facilityId: String, from: String, to: String): List<OtpDispensingEntity>

    @Query("SELECT * FROM ref_pending_adjustments ORDER BY txnDate DESC")
    fun observePendingAdjustments(): Flow<List<PendingAdjustmentEntity>>

    @Query("SELECT * FROM ref_stock_balances WHERE facilityId = :facilityId")
    suspend fun getBalances(facilityId: String): List<StockBalanceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertSupervisorLgas(v: List<SupervisorLgaEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertOtpDispensing(v: List<OtpDispensingEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertPendingAdjustments(v: List<PendingAdjustmentEntity>)
    @Query("DELETE FROM ref_supervisor_lgas") suspend fun clearSupervisorLgas()
    @Query("DELETE FROM ref_otp_dispensing") suspend fun clearOtpDispensing()
    @Query("DELETE FROM ref_pending_adjustments") suspend fun clearPendingAdjustments()

    /** One-transaction swap of a supervisor's whole cache (balances of the facilities they cover). */
    @Transaction
    suspend fun replaceSupervision(
        lgas: List<SupervisorLgaEntity>,
        balances: List<StockBalanceEntity>,
        dispensing: List<OtpDispensingEntity>,
        adjustments: List<PendingAdjustmentEntity>,
    ) {
        clearSupervisorLgas(); insertSupervisorLgas(lgas)
        clearBalances(); insertBalances(balances)
        clearOtpDispensing(); insertOtpDispensing(dispensing)
        clearPendingAdjustments(); insertPendingAdjustments(adjustments)
    }

    @Transaction
    suspend fun replaceCatalogue(products: List<ProductRefEntity>, lots: List<LotRefEntity>) {
        clearProducts(); insertProducts(products)
        clearLots(); insertLots(lots)
    }

    /** One-transaction swap of everything facility-specific, so a reader never sees a mix. */
    @Transaction
    suspend fun replaceFacilityStock(
        balances: List<StockBalanceEntity>,
        transfers: List<IncomingTransferEntity>,
        lines: List<IncomingTransferLineEntity>,
        dispensingDays: List<DispensingDayEntity>,
    ) {
        clearBalances(); insertBalances(balances)
        clearIncomingTransfers(); insertIncomingTransfers(transfers)
        clearTransferLines(); insertTransferLines(lines)
        clearDispensingDays(); insertDispensingDays(dispensingDays)
    }
}
