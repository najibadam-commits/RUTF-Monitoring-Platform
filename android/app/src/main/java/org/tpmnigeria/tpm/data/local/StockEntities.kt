package org.tpmnigeria.tpm.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/*
 * Offline cache for facility stock recording (web migration 0101, brief §8). All of it is
 * server-derived and replaced on every refresh (StockRepository.refresh) — nothing here is field
 * data; what the user records lives in the sync queue until the server accepts it.
 */

@Entity(tableName = "ref_products")
data class ProductRefEntity(
    @PrimaryKey val id: String,
    val name: String,
    val unitsPerCarton: Int,
)

@Entity(tableName = "ref_lots")
data class LotRefEntity(
    @PrimaryKey val id: String,
    val productId: String,
    val lotNo: String,
    val expiryDate: String, // ISO date
)

/** Ledger balance at the user's facility, per lot ([lotKey] = lot id, or "" for rows with no lot). */
@Entity(tableName = "ref_stock_balances", primaryKeys = ["facilityId", "lotKey"])
data class StockBalanceEntity(
    val facilityId: String,
    val lotKey: String,
    val lotId: String?,
    val balance: Int,
    val refreshedAtMillis: Long,
)

/** A transfer in transit to the user's facility — what Receive Stock offers to confirm. */
@Entity(tableName = "ref_incoming_transfers")
data class IncomingTransferEntity(
    @PrimaryKey val id: String,
    val code: String?,
    val fromFacilityId: String,
    val toFacilityId: String,
    val issuedDate: String,
    val sachetsIssued: Int,
    val documentNo: String?,
)

/** The lots and quantities a transfer was issued with — pre-fills Receive Stock. */
@Entity(tableName = "ref_incoming_transfer_lines", primaryKeys = ["transferId", "lineNo"])
data class IncomingTransferLineEntity(
    val transferId: String,
    val lineNo: Int,
    val lotId: String?,
    val quantity: Int,
)

/** Days that already have OTP dispensing recorded server-side (one entry per day per OTP). */
@Entity(tableName = "ref_dispensing_days", primaryKeys = ["facilityId", "dispenseDate"])
data class DispensingDayEntity(
    val facilityId: String,
    val dispenseDate: String,
)

/** An LGA the signed-in supervisor covers (web migration 0103's supervisor_lgas). */
@Entity(tableName = "ref_supervisor_lgas")
data class SupervisorLgaEntity(
    @PrimaryKey val lgaId: String,
)

/** Recent OTP daily dispensing at the facilities a supervisor covers — for the OTP Verification
 *  preview of the verification factor, offline. Aggregate tallies only (brief §10). */
@Entity(tableName = "ref_otp_dispensing", primaryKeys = ["facilityId", "dispenseDate"])
data class OtpDispensingEntity(
    val facilityId: String,
    val dispenseDate: String,
    val newAdmissions: Int,
    val sachetsDispensed: Int,
)

/** An adjustment a facility recorded that still waits for supervisor confirmation (DECISIONS R7). */
@Entity(tableName = "ref_pending_adjustments")
data class PendingAdjustmentEntity(
    @PrimaryKey val id: String,
    val facilityId: String,
    val txnDate: String,
    val lotId: String?,
    val quantity: Int,
    val reason: String?,
)
