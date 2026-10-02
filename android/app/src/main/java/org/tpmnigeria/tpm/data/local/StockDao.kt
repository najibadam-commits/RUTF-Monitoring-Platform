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
