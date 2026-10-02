package org.tpmnigeria.tpm.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StockProjectionTest {
    private val lots = mapOf("lot-a" to LotInfo("A-1", "2027-01-31"), "lot-b" to LotInfo("B-1", "2026-11-30"))
    private val synced = listOf(SyncedBalance("lot-a", "lot-a", 300), SyncedBalance("lot-b", "lot-b", 100))

    private fun receipt(vararg lines: LedgerLine) =
        LedgerSubmissions.receipt("r1", "f1", "2026-10-01", lines.toList(), "t1", null, "dev", emptyList(), "receipt")

    @Test
    fun `receipt adds quantity less damaged, and a new lot appears by its printed number`() {
        val p = projectStock(synced, lots, listOf(receipt(LedgerLine(lotId = "lot-a", quantity = 150, damaged = 10), LedgerLine(lotNo = "c-9", expiryDate = "2027-06-30", quantity = 50))))
        assertEquals(440, p.lots.first { it.lotKey == "lot-a" }.projected)
        val newLot = p.lots.first { it.lotKey == "new:C-9" }
        assertEquals(50, newLot.projected)
        assertEquals("2027-06-30", newLot.expiryDate)
        assertEquals(590, p.total)
    }

    @Test
    fun `issue, loss and dispensing reduce stock and an adjustment is signed`() {
        val pending = listOf(
            LedgerSubmissions.issue("i1", "f1", "f2", "2026-10-01", listOf(LedgerLine(lotId = "lot-b", quantity = 40)), null, "dev", emptyList(), "issue"),
            LedgerSubmissions.loss("l1", "f1", "2026-10-01", "loss_damaged", LedgerLine(lotId = "lot-a", quantity = 5), "torn", "dev", emptyList(), "loss"),
            LedgerSubmissions.loss("l2", "f1", "2026-10-01", "adjustment", LedgerLine(lotId = "lot-a", quantity = -3), "recount", "dev", emptyList(), "adj"),
            LedgerSubmissions.dispensing("d1", "f1", "2026-10-01", 1, 10, 70, 70, "dev", emptyList(), "disp"),
        )
        val p = projectStock(synced, lots, pending)
        assertEquals(60, p.lots.first { it.lotKey == "lot-b" }.projected)
        assertEquals(292, p.lots.first { it.lotKey == "lot-a" }.projected)
        assertEquals(70, p.pendingDispensed)
        assertEquals(282, p.total)
        assertEquals(4, p.pendingSubmissions)
    }

    @Test
    fun `a pending count sets the lot to what was counted, after earlier pending entries`() {
        val pending = listOf(
            receipt(LedgerLine(lotId = "lot-a", quantity = 100)),
            LedgerSubmissions.stockCount("c1", "f1", "2026-10-02", listOf(LedgerLine(lotId = "lot-a", quantity = 390)), "dev", emptyList(), "count"),
        )
        assertEquals(390, projectStock(synced, lots, pending).lots.first { it.lotKey == "lot-a" }.projected)
    }

    @Test
    fun `lots sort by expiry, earliest first`() {
        assertEquals(listOf("lot-b", "lot-a"), projectStock(synced, lots, emptyList()).lots.map { it.lotKey })
    }

    @Test
    fun `cartons and loose sachets`() {
        assertEquals(1_512, toSachets(10, 12, 150))
    }

    @Test
    fun `submissions send exactly the parameters migration 0101 expects`() {
        val r = receipt(LedgerLine(lotId = "lot-a", quantity = 150, damaged = 2))
        assertEquals("record_receipt", r.rpc)
        assertEquals(setOf("p_local_id", "p_facility_id", "p_txn_date", "p_lines", "p_transfer_id", "p_document_no", "p_device_id"), r.params.keys)
        val line = r.params["p_lines"]!!.jsonArray.single().jsonObject
        assertEquals("150", line["quantity"]!!.jsonPrimitive.content)
        assertEquals("2", line["damaged"]!!.jsonPrimitive.content)

        val c = LedgerSubmissions.stockCount("c1", "f1", "2026-10-02", listOf(LedgerLine(lotId = "lot-a", quantity = 90)), "dev", emptyList(), "count")
        assertEquals("90", c.params["p_lines"]!!.jsonArray.single().jsonObject["physical_count"]!!.jsonPrimitive.content)
        assertEquals(setOf("p_local_id", "p_facility_id", "p_count_date", "p_lines", "p_device_id"), c.params.keys)

        val d = LedgerSubmissions.dispensing("d1", "f1", "2026-10-01", 1, 10, 72, 70, "dev", emptyList(), "disp")
        assertEquals(
            setOf("p_local_id", "p_facility_id", "p_dispense_date", "p_new_admissions", "p_children_seen", "p_sachets_prescribed", "p_sachets_dispensed", "p_device_id"),
            d.params.keys,
        )
    }

    @Test
    fun `a submission survives the sync queue's JSON round trip`() {
        val s = receipt(LedgerLine(lotNo = "X-1", expiryDate = "2027-01-01", quantity = 10))
        val json = Json { ignoreUnknownKeys = true }
        val back = json.decodeFromString(LedgerSubmission.serializer(), json.encodeToString(LedgerSubmission.serializer(), s))
        assertEquals(s, back)
        assertTrue(back.params.containsKey("p_lines"))
    }
}
