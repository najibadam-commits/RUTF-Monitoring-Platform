package org.tpmnigeria.tpm.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tpmnigeria.tpm.domain.model.UserRole

class MobileAccessTest {

    @Test
    fun everyDatabaseRoleWithMobileAccessMapsToItsOwnRole() {
        assertEquals(UserRole.SuperAdmin, UserRole.fromDbValue("super_admin"))
        assertEquals(UserRole.ProjectAdmin, UserRole.fromDbValue("project_admin"))
        assertEquals(UserRole.StateCoordinator, UserRole.fromDbValue("state_coordinator"))
        assertEquals(UserRole.FieldMonitor, UserRole.fromDbValue("tpm_supervisor"))
        assertEquals(UserRole.Dri, UserRole.fromDbValue("dri"))
    }

    @Test
    fun viewerAndUnknownRolesStayRejected() {
        assertNull(UserRole.fromDbValue("viewer"))
        assertNull(UserRole.fromDbValue("something_new"))
        assertNull(UserRole.fromDbValue(""))
    }

    @Test
    fun roleLabelsMatchTheWebPlatform() {
        assertEquals("Super Admin", UserRole.SuperAdmin.label)
        assertEquals("Project Admin", UserRole.ProjectAdmin.label)
        assertEquals("State Coordinator", UserRole.StateCoordinator.label)
        assertEquals("TPM Field Monitor", UserRole.FieldMonitor.label)
        assertEquals("DRI", UserRole.Dri.label)
    }

    @Test
    fun existingFieldMonitorAndDriCapabilitiesAreUnchanged() {
        assertTrue(MobileAccess.canRegisterFinding(UserRole.FieldMonitor))
        assertTrue(MobileAccess.canVerifyResolution(UserRole.FieldMonitor))
        assertTrue(MobileAccess.canCaptureAttendance(UserRole.FieldMonitor))
        assertFalse(MobileAccess.canRespondToFinding(UserRole.FieldMonitor))

        assertTrue(MobileAccess.canRespondToFinding(UserRole.Dri))
        assertFalse(MobileAccess.canRegisterFinding(UserRole.Dri))
        assertFalse(MobileAccess.canVerifyResolution(UserRole.Dri))
        assertFalse(MobileAccess.canCaptureAttendance(UserRole.Dri))
    }

    @Test
    fun seniorRolesFollowTheWebRbacMatrix() {
        // Mirrors the web's canCreateIssue / canVerify: Super Admin and Project Admin yes,
        // State Coordinator (review-only) no.
        listOf(UserRole.SuperAdmin, UserRole.ProjectAdmin).forEach {
            assertTrue(MobileAccess.canRegisterFinding(it))
            assertTrue(MobileAccess.canVerifyResolution(it))
        }
        assertFalse(MobileAccess.canRegisterFinding(UserRole.StateCoordinator))
        assertFalse(MobileAccess.canVerifyResolution(UserRole.StateCoordinator))
    }

    @Test
    fun seniorRolesNeverActAsTheFieldWorkerThemselves() {
        listOf(UserRole.SuperAdmin, UserRole.ProjectAdmin, UserRole.StateCoordinator).forEach {
            assertFalse("$it must not respond as a DRI on mobile", MobileAccess.canRespondToFinding(it))
            assertFalse("$it must not capture Field Monitor attendance", MobileAccess.canCaptureAttendance(it))
            assertTrue(MobileAccess.isOversightRole(it))
        }
        assertFalse(MobileAccess.isOversightRole(UserRole.FieldMonitor))
        assertFalse(MobileAccess.isOversightRole(UserRole.Dri))
    }
}
