package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SlaCalculatorTest {

    private val baseIssue = Issue(
        id = "TEST-1", state = "State", lga = "LGA", ward = "Ward", settlement = "Settlement", site = "Site",
        category = "Cat", severity = Severity.Medium, description = "Desc", reporter = "Rep",
        dateReported = LocalDate.of(2026, 8, 1), gpsIssue = GpsCapture(0.0, 0.0, 0),
        status = IssueStatus.New
    )

    @Test
    fun `sla is not active for closed issues`() {
        val closed = baseIssue.copy(status = IssueStatus.VerifiedClosed)
        val sla = computeSla(closed)
        assertFalse(sla.hasSla)
    }

    @Test
    fun `a finding is past target after 30 days, whatever its severity`() {
        // The RUTF Finding target (FINDING_TARGET_DAYS, DECISIONS R101) replaces the per-severity SLA.
        for (severity in Severity.entries) {
            val issue = baseIssue.copy(severity = severity)
            assertFalse("Day 30 is still within target ($severity)", computeSla(issue, LocalDate.of(2026, 8, 31)).overdue)
            assertTrue("Day 31 is past target ($severity)", computeSla(issue, LocalDate.of(2026, 9, 1)).overdue)
        }
    }

    @Test
    fun `labels count the days to or past the target`() {
        assertEquals("26d to target", computeSla(baseIssue, LocalDate.of(2026, 8, 5)).label)
        assertEquals("Past target by 4d", computeSla(baseIssue, LocalDate.of(2026, 9, 4)).label)
    }
}
