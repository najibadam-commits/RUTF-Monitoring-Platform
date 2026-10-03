package org.tpmnigeria.tpm.data

import android.content.Context
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.local.DispensingDayEntity
import org.tpmnigeria.tpm.data.local.FacilityRefEntity
import org.tpmnigeria.tpm.data.local.OtpDispensingEntity
import org.tpmnigeria.tpm.data.local.PendingAdjustmentEntity
import org.tpmnigeria.tpm.data.local.SupervisorLgaEntity
import org.tpmnigeria.tpm.data.local.IncomingTransferEntity
import org.tpmnigeria.tpm.data.local.IncomingTransferLineEntity
import org.tpmnigeria.tpm.data.local.LotRefEntity
import org.tpmnigeria.tpm.data.local.ProductRefEntity
import org.tpmnigeria.tpm.data.local.StockBalanceEntity
import org.tpmnigeria.tpm.data.local.StockDao
import org.tpmnigeria.tpm.data.local.SyncQueueDao
import org.tpmnigeria.tpm.data.local.SyncQueueEntity
import org.tpmnigeria.tpm.data.remote.Supabase
import org.tpmnigeria.tpm.data.remote.dto.DispensingDayDto
import org.tpmnigeria.tpm.data.remote.dto.FacilityIdDto
import org.tpmnigeria.tpm.data.remote.dto.OtpDispensingDto
import org.tpmnigeria.tpm.data.remote.dto.PendingAdjustmentDto
import org.tpmnigeria.tpm.data.remote.dto.SupervisorLgaDto
import org.tpmnigeria.tpm.data.remote.dto.LotDto
import org.tpmnigeria.tpm.data.remote.dto.ProductDto
import org.tpmnigeria.tpm.data.remote.dto.StockBalanceDto
import org.tpmnigeria.tpm.data.remote.dto.TransferDto
import org.tpmnigeria.tpm.data.remote.dto.TransferLineDto
import org.tpmnigeria.tpm.domain.LedgerKind
import org.tpmnigeria.tpm.domain.LedgerSubmission
import org.tpmnigeria.tpm.domain.LotInfo
import org.tpmnigeria.tpm.domain.StockPosition
import org.tpmnigeria.tpm.domain.SyncedBalance
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncStatus
import org.tpmnigeria.tpm.domain.projectStock
import org.tpmnigeria.tpm.sync.SyncScheduler
import java.time.LocalDate

/** Sync-queue types that carry a [LedgerSubmission] as their payload. */
val LEDGER_SUBMISSION_TYPES = mapOf(
    LedgerKind.Receipt to SubmissionType.StockReceipt,
    LedgerKind.Issue to SubmissionType.StockIssue,
    LedgerKind.Dispensing to SubmissionType.Dispensing,
    LedgerKind.StockCount to SubmissionType.StockCount,
    LedgerKind.Loss to SubmissionType.StockLoss,
    LedgerKind.StoreCheck to SubmissionType.StoreCheck,
    LedgerKind.OtpVerification to SubmissionType.OtpVerification,
    LedgerKind.ConfirmAdjustment to SubmissionType.AdjustmentConfirmation,
)

/**
 * Facility stock recording (web migration 0101, brief §8). Reads come from the Room cache that
 * [refresh] fills — the server's RLS already limits it to the user's own facility — and writes go
 * into the shared sync queue as [LedgerSubmission]s, so every screen works offline and a retried
 * sync can't double-record (the server is idempotent on the submission's localId).
 */
class StockRepository(
    private val dao: StockDao,
    private val syncQueueDao: SyncQueueDao,
    private val appContext: Context,
) {
    private val postgrest get() = Supabase.client.postgrest
    private val json = Json { ignoreUnknownKeys = true }

    fun observeUnitsPerCarton(): Flow<Int> = dao.observeProducts().map { it.firstOrNull()?.unitsPerCarton ?: DEFAULT_UNITS_PER_CARTON }
    fun observeLots(): Flow<List<LotRefEntity>> = dao.observeLots()
    fun observeIncomingTransfers(facilityId: String): Flow<List<IncomingTransferEntity>> =
        combine(dao.observeIncomingTransfers(facilityId), observePendingSubmissions()) { transfers, pending ->
            // A transfer this device already received (still waiting to sync) is no longer offered.
            val receivedHere = pending.filter { it.kind == LedgerKind.Receipt }.mapNotNull { it.params["p_transfer_id"]?.toString()?.trim('"') }.toSet()
            transfers.filter { it.id !in receivedHere }
        }
    suspend fun getTransferLines(transferId: String) = dao.getTransferLines(transferId)

    /** Submissions not yet accepted by the server, oldest first. */
    fun observePendingSubmissions(): Flow<List<LedgerSubmission>> = syncQueueDao.observeAll().map { rows ->
        rows.filter { it.status != SyncStatus.Synced && it.submissionType in LEDGER_SUBMISSION_TYPES.values }
            .sortedBy { it.timestampMillis }
            .mapNotNull { runCatching { json.decodeFromString<LedgerSubmission>(it.payloadJson) }.getOrNull() }
    }

    fun observeStock(facilityId: String): Flow<StockPosition> =
        combine(dao.observeBalances(facilityId), dao.observeLots(), observePendingSubmissions()) { balances, lots, pending ->
            projectStock(
                synced = balances.map { SyncedBalance(it.lotKey, it.lotId, it.balance) },
                lots = lots.associate { it.id to LotInfo(it.lotNo, it.expiryDate) },
                pending = pending.filter { it.facilityId == facilityId },
            )
        }

    // ── Supervision (web migration 0103) ────────────────────────────────────────────────────────

    fun observeSupervisedFacilities(level: String): Flow<List<FacilityRefEntity>> = dao.observeSupervisedFacilities(level)

    /** Adjustments waiting for confirmation, minus those this device already confirmed (queued). */
    fun observePendingAdjustments(): Flow<List<PendingAdjustmentEntity>> =
        combine(dao.observePendingAdjustments(), observePendingSubmissions()) { adjustments, pending ->
            val confirmedHere = pending.filter { it.kind == LedgerKind.ConfirmAdjustment }
                .mapNotNull { it.params["p_txn_id"]?.toString()?.trim('"') }.toSet()
            adjustments.filter { it.id !in confirmedHere }
        }

    /** Ledger balance by lot at a supervised facility, as of the last sync. */
    suspend fun getBalances(facilityId: String) = dao.getBalances(facilityId)

    /** App-recorded dispensing at an OTP for a period (for the verification-factor preview). */
    suspend fun getRecordedDispensing(facilityId: String, from: LocalDate, to: LocalDate): Pair<Int, Int> {
        val rows = dao.getOtpDispensing(facilityId, from.toString(), to.toString())
        return rows.sumOf { it.newAdmissions } to rows.sumOf { it.sachetsDispensed }
    }

    /**
     * A supervisor's cache: their LGAs, and for the facilities they cover at their level the
     * ledger balances, recent OTP dispensing and adjustments waiting for confirmation.
     */
    suspend fun refreshSupervision(supervisorId: String, level: String) {
        val lgas = postgrest.from("supervisor_lgas").select(columns = Columns.list("lga_id")) {
            filter { eq("profile_id", supervisorId) }
        }.decodeList<SupervisorLgaDto>().map { it.lga_id }
        val facilities = if (lgas.isEmpty()) emptyList() else postgrest.from("facilities").select(columns = Columns.list("id")) {
            filter {
                eq("status", "approved"); eq("is_active", true)
                if (level == "otp_sites") {
                    eq("is_otp_site", true); isIn("lga_id", lgas)
                } else {
                    or { eq("facility_type", "state_store"); and { eq("facility_type", "lga_store"); isIn("lga_id", lgas) } }
                }
            }
        }.decodeList<FacilityIdDto>().map { it.id }

        val now = System.currentTimeMillis()
        val balances = if (facilities.isEmpty()) emptyList() else postgrest.from("stock_balances")
            .select(columns = Columns.list("facility_id", "lot_id", "balance")) { filter { isIn("facility_id", facilities) } }
            .decodeList<StockBalanceDto>()
        val since = LocalDate.now().minusDays(DISPENSING_DAYS_BACK).toString()
        val dispensing = if (level != "otp_sites" || facilities.isEmpty()) emptyList() else pageAll { from, to ->
            postgrest.from("otp_daily_dispensing").select(columns = Columns.list("facility_id", "dispense_date", "new_admissions", "sachets_dispensed")) {
                filter { isIn("facility_id", facilities); gte("dispense_date", since) }
                order("dispense_date", Order.ASCENDING); range(from, to)
            }.decodeList<OtpDispensingDto>()
        }
        val adjustments = if (facilities.isEmpty()) emptyList() else postgrest.from("stock_transactions")
            .select(columns = Columns.list("id", "facility_id", "txn_date", "lot_id", "quantity_sachets", "reason")) {
                filter { isIn("facility_id", facilities); eq("txn_type", "adjustment"); eq("status", "recorded") }
            }.decodeList<PendingAdjustmentDto>()

        dao.replaceSupervision(
            lgas = lgas.map(::SupervisorLgaEntity),
            balances = balances.map { StockBalanceEntity(it.facility_id, it.lot_id ?: "", it.lot_id, it.balance, now) },
            dispensing = dispensing.map { OtpDispensingEntity(it.facility_id, it.dispense_date, it.new_admissions, it.sachets_dispensed) },
            adjustments = adjustments.map { PendingAdjustmentEntity(it.id, it.facility_id, it.txn_date, it.lot_id, it.quantity_sachets, it.reason) },
        )
    }

    /** When the cached balances were last refreshed from the server (null = never). */
    fun observeRefreshedAt(facilityId: String): Flow<Long?> = dao.observeBalances(facilityId).map { rows -> rows.maxOfOrNull { it.refreshedAtMillis } }

    /** One OTP entry per day: already on the server, or already waiting to sync. */
    suspend fun isDispensingRecorded(facilityId: String, date: LocalDate): Boolean {
        if (dao.isDispensingDayRecorded(facilityId, date.toString())) return true
        return observePendingSubmissions().first().any { it.kind == LedgerKind.Dispensing && it.facilityId == facilityId && it.txnDate == date.toString() }
    }

    suspend fun submit(submission: LedgerSubmission) {
        syncQueueDao.insert(
            SyncQueueEntity(
                localId = "sq-${System.currentTimeMillis()}-${submission.localId}",
                issueId = submission.localId,
                submissionType = LEDGER_SUBMISSION_TYPES.getValue(submission.kind),
                status = SyncStatus.Pending,
                timestampMillis = System.currentTimeMillis(),
                payloadJson = json.encodeToString(LedgerSubmission.serializer(), submission),
            ),
        )
        SyncScheduler.syncNow(appContext)
    }

    /**
     * Refreshes the catalogue (products, lots) and — for a facility user — their facility's
     * balances, incoming transfers with their lines, and recent dispensing days. Any failure
     * leaves the previous cache in place.
     */
    suspend fun refresh(facilityId: String?) {
        val products = postgrest.from("products").select(columns = Columns.list("id", "name", "units_per_carton")).decodeList<ProductDto>()
        val lots = pageAll { from, to ->
            postgrest.from("product_lots").select(columns = Columns.list("id", "product_id", "lot_no", "expiry_date")) {
                order("id", Order.ASCENDING); range(from, to)
            }.decodeList<LotDto>()
        }
        dao.replaceCatalogue(
            products.map { ProductRefEntity(it.id, it.name, it.units_per_carton) },
            lots.map { LotRefEntity(it.id, it.product_id, it.lot_no, it.expiry_date) },
        )
        if (facilityId == null) return

        val now = System.currentTimeMillis()
        val balances = postgrest.from("stock_balances").select(columns = Columns.list("facility_id", "lot_id", "balance")) {
            filter { eq("facility_id", facilityId) }
        }.decodeList<StockBalanceDto>()
        val transfers = postgrest.from("transfers")
            .select(columns = Columns.list("id", "code", "from_facility_id", "to_facility_id", "issued_date", "sachets_issued", "document_no")) {
                filter { eq("to_facility_id", facilityId); eq("status", "in_transit") }
            }.decodeList<TransferDto>()
        // The supplier's issue lines come through incoming_transfer_lines() (web migration 0108):
        // a facility user can't read the supplier's ledger rows directly (DECISIONS R27).
        val lines = if (transfers.isEmpty()) emptyList() else postgrest
            .rpc("incoming_transfer_lines", buildJsonObject { put("p_facility_id", facilityId) })
            .decodeList<TransferLineDto>()
        val since = LocalDate.now().minusDays(DISPENSING_DAYS_BACK).toString()
        val days = postgrest.from("otp_daily_dispensing").select(columns = Columns.list("dispense_date")) {
            filter { eq("facility_id", facilityId); gte("dispense_date", since) }
        }.decodeList<DispensingDayDto>()

        dao.replaceFacilityStock(
            balances = balances.map { StockBalanceEntity(facilityId, it.lot_id ?: "", it.lot_id, it.balance, now) }
                .ifEmpty { listOf(StockBalanceEntity(facilityId, "", null, 0, now)) }, // remembers "refreshed, holds nothing"
            transfers = transfers.map { IncomingTransferEntity(it.id, it.code, it.from_facility_id, it.to_facility_id, it.issued_date, it.sachets_issued, it.document_no) },
            lines = lines.groupBy { it.transfer_id }.flatMap { (transferId, ls) ->
                ls.mapIndexed { i, l -> IncomingTransferLineEntity(transferId, i + 1, l.lot_id, l.quantity_sachets) }
            },
            dispensingDays = days.map { DispensingDayEntity(facilityId, it.dispense_date) },
        )
    }

    private suspend fun <T> pageAll(page: suspend (Long, Long) -> List<T>): List<T> {
        val all = mutableListOf<T>()
        var from = 0L
        while (true) {
            val rows = page(from, from + PAGE_SIZE - 1)
            all += rows
            if (rows.size < PAGE_SIZE) return all
            from += PAGE_SIZE
        }
    }

    companion object {
        const val DEFAULT_UNITS_PER_CARTON = 150
        private const val PAGE_SIZE = 1000L
        private const val DISPENSING_DAYS_BACK = 120L
    }
}
