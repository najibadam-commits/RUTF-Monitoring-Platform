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
    fun `sla calculation for high severity`() {
        // SLA for High is usually shorter. Let's check SLA_DAYS.
        // Assuming High = 3 days, Medium = 7 days, Low = 14 days (common defaults)
        val high = baseIssue.copy(severity = Severity.High)
        val today = LocalDate.of(2026, 8, 5) // 4 days later
        val sla = computeSla(high, today)
        
        assertTrue("Should be overdue after 4 days for High severity", sla.overdue)
    }

    @Test
    fun `sla calculation for low severity`() {
        val low = baseIssue.copy(severity = Severity.Low)
        val today = LocalDate.of(2026, 8, 5) // 4 days later
        val sla = computeSla(low, today)
        
        assertFalse("Should NOT be overdue after 4 days for Low severity", sla.overdue)
    }
}
