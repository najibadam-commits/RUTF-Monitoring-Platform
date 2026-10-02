package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

// Read side of web migration 0101 — only the columns the app caches.

@Serializable
data class ProductDto(val id: String, val name: String, val units_per_carton: Int)

@Serializable
data class LotDto(val id: String, val product_id: String, val lot_no: String, val expiry_date: String)

@Serializable
data class StockBalanceDto(val facility_id: String, val lot_id: String? = null, val balance: Int)

@Serializable
data class TransferDto(
    val id: String,
    val code: String? = null,
    val from_facility_id: String,
    val to_facility_id: String,
    val issued_date: String,
    val sachets_issued: Int,
    val document_no: String? = null,
)

@Serializable
data class TransferLineDto(val transfer_id: String, val lot_id: String? = null, val quantity_sachets: Int, val local_id: String? = null)

@Serializable
data class DispensingDayDto(val dispense_date: String)

@Serializable
data class LedgerPhotoInsertDto(
    val submission_local_id: String,
    val facility_id: String,
    val storage_path: String,
    val kind: String,
    val mime_type: String = "image/jpeg",
    val size_bytes: Long? = null,
)
