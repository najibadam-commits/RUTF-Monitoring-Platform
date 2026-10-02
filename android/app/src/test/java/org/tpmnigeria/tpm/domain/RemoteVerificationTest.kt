package org.tpmnigeria.tpm.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tpmnigeria.tpm.data.remote.dto.GpsCaptureRemoteDto
import org.tpmnigeria.tpm.data.remote.dto.HistoryRemoteDto
import org.tpmnigeria.tpm.data.remote.dto.IssuePullDto
import org.tpmnigeria.tpm.data.remote.dto.PhotoRemoteDto
import org.tpmnigeria.tpm.domain.model.IssueStatus

class RemoteVerificationTest {
    private fun dto(
        history: List<HistoryRemoteDto> = emptyList(),
        gps: List<GpsCaptureRemoteDto> = emptyList(),
        photos: List<PhotoRemoteDto> = emptyList(),
    ) = IssuePullDto(
        id = "i1", code = "ALK-ALK-WAS-26-DM001", description = "d", reported_at = "2026-09-07T08:00:00Z",
        updated_at = "2026-09-20T10:00:00Z", priority = "medium", status = "verified_closed",
        category_id = "c", state_id = "s", lga_id = "l", lat = 10.5, lng = 9.25,
        issue_history = history, issue_gps_captures = gps, issue_photos = photos,
    )

    private fun event(action: String, at: String, note: String? = null) = HistoryRemoteDto(action, note, at, "Someone")

    @Test
    fun nothingVerificationRelatedMeansNoVerification() {
        val d = dto(history = listOf(event("Finding reported", "2026-09-07T08:00:00Z")), photos = listOf(PhotoRemoteDto("discovery", "mov", "a/b.jpg")))
        assertNull(d.toVerification(IssueStatus.Ongoing))
    }

    @Test
    fun verifiedAndClosedIsConfirmedWithItsNotePhotosAndGps() {
        val d = dto(
            history = listOf(event("Verified and closed", "2026-09-11T09:30:00Z", "All fixed")),
            gps = listOf(GpsCaptureRemoteDto("verification", 10.6, 9.3, 7.4)),
            photos = listOf(PhotoRemoteDto("verification", "selfie", "i1/verification_selfie.jpg"), PhotoRemoteDto("verification", "mov", "i1/verification_mov.jpg")),
        )
        val v = d.toVerification(IssueStatus.VerifiedClosed)!!
        assertTrue(v.confirmed)
        assertEquals("All fixed", v.comment)
        assertEquals("2026-09-11", v.date)
        assertEquals(10.6, v.gps.lat, 0.0)
        assertEquals(7, v.gps.accuracyMeters)
        assertEquals("storage:i1/verification_selfie.jpg", v.selfiePhotoPath)
        assertEquals("storage:i1/verification_mov.jpg", v.movPhotoPath)
    }

    @Test
    fun notResolvedIsNotConfirmed() {
        val d = dto(history = listOf(event("Final Verification — Not Resolved", "2026-09-12T09:00:00Z", "Still leaking")))
        val v = d.toVerification(IssueStatus.Reopened)!!
        assertFalse(v.confirmed)
        assertEquals("Still leaking", v.comment)
    }

    @Test
    fun theNewestOutcomeWinsWhenAFindingWasReopenedThenClosed() {
        val d = dto(history = listOf(
            event("Verified and closed", "2026-09-15T09:00:00Z", "ok now"),
            event("Final Verification — Not Resolved", "2026-09-12T09:00:00Z", "not yet"),
        ))
        val v = d.toVerification(IssueStatus.VerifiedClosed)!!
        assertTrue(v.confirmed)
        assertEquals("ok now", v.comment)
    }

    @Test
    fun withoutAnEventTheStatusDecidesTheOutcomeAndGpsFallsBackToTheFindingLocation() {
        val d = dto(photos = listOf(PhotoRemoteDto("verification", "selfie", "i1/verification_selfie.jpg")))
        val closed = d.toVerification(IssueStatus.VerifiedClosed)!!
        assertTrue(closed.confirmed)
        assertEquals(10.5, closed.gps.lat, 0.0)
        assertFalse(d.toVerification(IssueStatus.Reopened)!!.confirmed)
    }
}
