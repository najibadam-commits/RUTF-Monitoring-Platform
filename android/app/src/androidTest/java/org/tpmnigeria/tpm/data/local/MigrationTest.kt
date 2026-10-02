package org.tpmnigeria.tpm.data.local

import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.tpmnigeria.tpm.domain.model.SyncStatus

/**
 * Exercises the real migration chain (see Migrations.kt) against databases seeded with the kind
 * of data a field device actually has: an unsynced issue and a pending/failed sync_queue row.
 * This is the test the production-stabilization audit's Section 7/27 calls for — proof that a
 * schema upgrade can no longer silently destroy field data the way
 * `fallbackToDestructiveMigration()` used to. I could not run this myself (no working
 * Gradle/instrumentation in the environment this was written in) — run it in Android Studio
 * (right-click → Run) on a device/emulator before relying on it.
 */
@RunWith(AndroidJUnit4::class)
class MigrationTest {
    private val testDb = "migration-test"

    @get:Rule
    val helper: MigrationTestHelper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        TpmDatabase::class.java.canonicalName!!,
        FrameworkSQLiteOpenHelperFactory(),
    )

    /** v3→v4→v5 are genuine no-ops (identical exported schema); v5→v6 adds `issues.locationOther`.
     *  Validated against the real exported 4/5/6.json fixtures via runMigrationsAndValidate. */
    @Test
    fun migrate3To6_preservesUnsyncedIssueAndSyncQueueRow() {
        helper.createDatabase(testDb, 3).apply {
            execSQL(
                """INSERT INTO issues (id, remoteId, remoteCode, state, stateId, lga, lgaId, ward, wardId,
                   settlement, settlementId, site, siteId, category, categoryId, severity, description,
                   reporter, dateReported, gpsIssue, status, assignedDriId, movPhotoPath, selfiePhotoPath,
                   driResponse, verification, history)
                   VALUES ('KN-2024-0001', NULL, NULL, 'Kano', NULL, 'Nassarawa', NULL, 'Airport Ward', NULL,
                   'Testville', NULL, '', NULL, 'Cold Chain', NULL, 'High', 'Unsynced field issue — must survive migration',
                   'Test Reporter', '2024-01-01', '{}', 'New', NULL, NULL, NULL, NULL, NULL, '[]')""",
            )
            execSQL(
                """INSERT INTO sync_queue (localId, issueId, submissionType, status, timestampMillis, payloadJson)
                   VALUES ('sq-1', 'KN-2024-0001', 'NewIssue', 'Pending', 1700000000000, '{}')""",
            )
            close()
        }

        val migrated = helper.runMigrationsAndValidate(testDb, 6, true, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)

        migrated.query("SELECT id, description FROM issues WHERE id = 'KN-2024-0001'").use { cursor ->
            assertTrue("Unsynced issue row must survive the migration", cursor.moveToFirst())
            assertEquals(
                "Unsynced field issue — must survive migration",
                cursor.getString(cursor.getColumnIndexOrThrow("description")),
            )
        }
        migrated.query("SELECT localId, status FROM sync_queue WHERE localId = 'sq-1'").use { cursor ->
            assertTrue("Pending sync_queue row must survive the migration", cursor.moveToFirst())
            assertEquals("Pending", cursor.getString(cursor.getColumnIndexOrThrow("status")))
        }
    }

    /** v6→v7 adds `sync_queue.retryCount`. Runs through Room's own real migration path (not just
     *  a hand-invoked migrate() call) by opening the resulting db via the production builder —
     *  and confirms a row that predates the column gets the column's DEFAULT 0, not null/crash. */
    @Test
    fun migrate6To7_addsRetryCountDefaultAndPreservesFailedRow() {
        helper.createDatabase(testDb, 6).apply {
            execSQL(
                """INSERT INTO sync_queue (localId, issueId, submissionType, status, timestampMillis, payloadJson)
                   VALUES ('sq-2', 'KN-2024-0002', 'DriResponse', 'Failed', 1700000000000, '{}')""",
            )
            close()
        }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_6_7)
            .build()
        try {
            val queueItem = runBlocking { db.syncQueueDao().getByStatus(SyncStatus.Failed) }.first()
            assertEquals("sq-2", queueItem.localId)
            assertEquals("A pre-existing row must get retryCount's DEFAULT 0, not lose its data", 0, queueItem.retryCount)
        } finally {
            db.close()
        }
    }

    /** v7→v8 adds `abbr` to the three ref_* lookup tables and creates issue_id_counters (see the
     *  structured mobile_code restyle — IssueIdGenerator). Both are additive/new, but this still
     *  confirms a pre-existing cached LGA row survives the ALTER TABLEs and that the new counter
     *  table actually works end to end through Room, not just "the CREATE TABLE didn't throw." */
    @Test
    fun migrate7To8_addsAbbrColumnsAndCounterTable_preservesExistingLga() {
        helper.createDatabase(testDb, 6).apply {
            execSQL("INSERT INTO ref_lgas (id, stateId, name) VALUES ('lga-1', 'state-1', 'Kano Municipal')")
            close()
        }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_6_7, MIGRATION_7_8)
            .build()
        try {
            val lga = runBlocking { db.referenceDao().getLga("lga-1") }
            assertEquals("Kano Municipal", lga?.name)
            assertEquals("Pre-existing row must get abbr's implicit NULL default, not disappear", null, lga?.abbr)

            val first = runBlocking { db.issueIdCounterDao().nextSequence("KMC-NAS-WSF", 2026, "NI") }
            val second = runBlocking { db.issueIdCounterDao().nextSequence("KMC-NAS-WSF", 2026, "NI") }
            assertEquals(1, first)
            assertEquals(2, second)
        } finally {
            db.close()
        }
    }

    /** v8→v9 creates `attendance_records` (Daily Attendance — see AttendanceEntity,
     *  DECISIONS.md #24 in the web project). Brand-new table, nothing from v8 to preserve; this
     *  just confirms the CREATE TABLE actually round-trips through Room's own DAO, not just that
     *  it didn't throw. */
    @Test
    fun migrate8To9_createsAttendanceRecordsTable() {
        helper.createDatabase(testDb, 8).apply { close() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_8_9)
            .build()
        try {
            runBlocking {
                db.attendanceDao().insert(
                    AttendanceEntity(
                        localId = "att-fm-1-2026-09-12",
                        remoteId = null,
                        fieldMonitorId = "fm-1",
                        attendanceDate = "2026-09-12",
                        capturedAtMillis = 1_700_000_000_000L,
                        lat = 9.0765,
                        lng = 7.3986,
                        gpsAccuracyM = 8,
                        selfiePhotoPath = "/data/evidence/selfie.jpg",
                        assignmentLocationPhotoPath = "/data/evidence/location.jpg",
                        deviceId = "abc123",
                    ),
                )
            }
            val stored = runBlocking { db.attendanceDao().findForFieldMonitorAndDate("fm-1", "2026-09-12") }
            assertEquals("att-fm-1-2026-09-12", stored?.localId)
            assertEquals(null, stored?.remoteId)
        } finally {
            db.close()
        }
    }
}
