package org.tpmnigeria.tpm.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncQueueItem
import org.tpmnigeria.tpm.domain.model.SyncStatus

class SyncReportTest {
    private fun item(id: String, status: SyncStatus, retries: Int, at: Long) =
        SyncQueueItem(id, id, SubmissionType.Dispensing, status, at, "{}", retries)

    @Test fun `empty queue reports nothing waiting`() {
        val r = buildSyncReport(emptyList(), emptyMap())
        assertEquals(0, r.pending); assertEquals(0, r.failed); assertNull(r.oldestPendingAt); assertTrue(r.failures.isEmpty())
    }

    @Test fun `counts pending and failed, ignores synced, lists only rows that have failed`() {
        val r = buildSyncReport(
            listOf(
                item("a", SyncStatus.Pending, 0, 3_000),
                item("b", SyncStatus.Pending, 2, 2_000),
                item("c", SyncStatus.Failed, 5, 4_000),
                item("d", SyncStatus.Synced, 0, 1_000),
            ),
            mapOf("b" to "timeout", "c" to "Facility not found or inactive"),
        )
        assertEquals(2, r.pending)
        assertEquals(1, r.failed)
        assertEquals("1970-01-01T00:00:02Z", r.oldestPendingAt)
        assertEquals(listOf("c", "b"), r.failures.map { it.localId }) // Failed first
        assertEquals("Facility not found or inactive", r.failures[0].error)
        assertEquals(5, r.failures[0].attempts)
    }

    @Test fun `error keeps only the first line and strips keys and tokens`() {
        val raw = "permission denied for function x\nURL: https://x.supabase.co/rest/v1/rpc/x\nHeaders: [apikey=sb_publishable_abc, Authorization=Bearer eyJhbGciOi.eyJzdWIi.sig]"
        assertEquals("permission denied for function x", cleanSyncError(raw))
        val inline = cleanSyncError("failed with Bearer eyJhbGciOi.eyJzdWIi.sig attached")!!
        assertFalse(inline.contains("eyJ"))
        assertEquals(300, cleanSyncError("x".repeat(1000))!!.length)
        assertNull(cleanSyncError(null))
    }

    @Test fun `caps the failures sent`() {
        val many = (1..80).map { item("i$it", SyncStatus.Pending, 1, it.toLong()) }
        assertEquals(MAX_REPORTED_FAILURES, buildSyncReport(many, emptyMap()).failures.size)
    }
}
