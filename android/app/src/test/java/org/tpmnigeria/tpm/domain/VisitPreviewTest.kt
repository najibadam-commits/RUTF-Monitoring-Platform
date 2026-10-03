package org.tpmnigeria.tpm.domain

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as tools/db/test-visits.js, so the phone's preview agrees with the server. */
class VisitPreviewTest {
    private fun types(list: List<PreviewFinding>) = list.map { it.type }

    @Test
    fun `VF 1_25 raises a dispensing gap and a matching count raises nothing else`() {
        val f = previewVisitFindings(listOf(VisitCount(800, 800, 0)), hardToReach = false, otp = OtpRecount(true, 875, 700))
        assertEquals(listOf("dispensing_gap"), types(f))
        assertEquals(1.25, verificationFactor(875, 700), 0.0)
    }

    @Test
    fun `VF inside 0_90 to 1_10 raises nothing`() {
        assertEquals(emptyList<String>(), types(previewVisitFindings(listOf(VisitCount(500, 500, 0)), false, otp = OtpRecount(true, 730, 700))))
    }

    @Test
    fun `register missing wins over the VF`() {
        assertEquals(listOf("register_missing"), types(previewVisitFindings(emptyList(), false, otp = OtpRecount(false, null, 700))))
    }

    @Test
    fun `store check - variance, no stock card and stock on the floor`() {
        val f = previewVisitFindings(
            listOf(VisitCount(1500, 1300, 0)), hardToReach = false,
            store = StoreChecklist(stockCardPresent = false, stockCardUpToDate = null, storageDry = true, storageOffFloor = false, pestsSeen = false),
        )
        assertEquals(listOf("stock_variance", "no_stock_card", "poor_storage"), types(f))
    }

    @Test
    fun `hard-to-reach uses the 10 percent limit`() {
        val counts = listOf(VisitCount(1000, 930, 0)) // 7 %
        assertEquals(listOf("stock_variance"), types(previewVisitFindings(counts, hardToReach = false)))
        assertEquals(emptyList<String>(), types(previewVisitFindings(counts, hardToReach = true)))
    }

    @Test
    fun `expired sachets on the shelf`() {
        assertEquals(listOf("expired_stock"), types(previewVisitFindings(listOf(VisitCount(100, 100, 12)), false)))
    }

    @Test
    fun `distance - about 108 m for 0_001 degree of longitude near Katsina`() {
        val d = distanceMeters(12.9855, 7.6171, 12.9855, 7.6181)
        assertTrue("was $d", d in 106..110) // PostGIS st_distance gives 108 for the same points
    }

    @Test
    fun `record_visit parameters`() {
        val s = LedgerSubmissions.visit(
            LedgerKind.OtpVerification, "v1", "f1", "2026-10-03", 12.0, 7.6, 8,
            listOf(VisitCountLine(lotId = "l1", physicalCount = 800)),
            buildJsonObject { put("register_present", true); put("sachets_dispensed_counted", 875) },
            "2026-09-25", "2026-10-01", "dev", emptyList(), "visit",
        )
        assertEquals("record_visit", s.rpc)
        assertEquals(
            setOf("p_local_id", "p_visit_type", "p_facility_id", "p_visit_date", "p_lat", "p_lng", "p_gps_accuracy_m",
                "p_lines", "p_checklist", "p_period_start", "p_period_end", "p_device_id"),
            s.params.keys,
        )
        assertEquals("\"otp_verification\"", s.params["p_visit_type"].toString())
    }
}
