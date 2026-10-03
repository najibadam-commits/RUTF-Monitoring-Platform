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

    /** v8→v9 creates `attendance_records` (Daily Attendance, removed again in v13). Validated
     *  against the exported 9.json schema. */
    @Test
    fun migrate8To9_createsAttendanceRecordsTable() {
        helper.createDatabase(testDb, 8).apply { close() }
        helper.runMigrationsAndValidate(testDb, 9, true, MIGRATION_8_9).close()
    }

    /** v12→v13 removes Daily Attendance: the table goes, queued attendance submissions go, the
     *  photos on the phone are deleted — and every other queued submission stays. */
    @Test
    fun migrate12To13_removesAttendanceButKeepsOtherQueuedWork() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val selfie = java.io.File(context.cacheDir, "att-selfie.jpg").apply { writeText("x") }
        helper.createDatabase(testDb, 12).apply {
            execSQL(
                """INSERT INTO attendance_records (localId, remoteId, fieldMonitorId, attendanceDate, capturedAtMillis,
                   lat, lng, gpsAccuracyM, selfiePhotoPath, assignmentLocationPhotoPath, deviceId)
                   VALUES ('att-fm-1-2026-09-12', NULL, 'fm-1', '2026-09-12', 1700000000000, 9.07, 7.39, 8,
                   '${selfie.absolutePath}', '/nonexistent/location.jpg', 'abc123')""",
            )
            execSQL("""INSERT INTO sync_queue (localId, issueId, submissionType, status, timestampMillis, payloadJson, retryCount)
                       VALUES ('sq-att', 'att-fm-1-2026-09-12', 'Attendance', 'Pending', 1700000000000, '{}', 0)""")
            execSQL("""INSERT INTO sync_queue (localId, issueId, submissionType, status, timestampMillis, payloadJson, retryCount)
                       VALUES ('sq-disp', 'disp-1', 'Dispensing', 'Pending', 1700000000001, '{}', 0)""")
            close()
        }

        val migrated = helper.runMigrationsAndValidate(testDb, 13, true, MIGRATION_12_13)
        migrated.query("SELECT localId FROM sync_queue ORDER BY localId").use { c ->
            val ids = buildList { while (c.moveToNext()) add(c.getString(0)) }
            assertEquals(listOf("sq-disp"), ids)
        }
        migrated.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attendance_records'").use { c ->
            assertTrue("attendance_records must be gone", !c.moveToFirst())
        }
        assertTrue("the selfie on the phone must be deleted", !selfie.exists())
        migrated.close()
    }

    /** v9→v10 creates `ref_facilities` (RUTF facility registry cache — see FacilityRefEntity,
     *  web migration 0100). Brand-new table; confirms the CREATE TABLE matches what Room expects
     *  and round-trips through the DAO, including the whole-table replace. */
    @Test
    fun migrate9To10_createsFacilitiesTable() {
        helper.createDatabase(testDb, 9).apply { close() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_9_10)
            .build()
        try {
            val otp = FacilityRefEntity(
                id = "f-otp", name = "Bakori PHC", facilityType = "health_facility", lgaId = "lga-1",
                wardId = "ward-1", lat = 11.55, lng = 7.42, isOtpSite = true, suppliedById = "f-lst",
            )
            val store = FacilityRefEntity(
                id = "f-lst", name = "Bakori LGA Store", facilityType = "lga_store", lgaId = "lga-1",
                wardId = null, lat = null, lng = null, isOtpSite = false, suppliedById = null,
            )
            runBlocking { db.referenceDao().replaceFacilities(listOf(otp, store)) }
            assertEquals(otp, runBlocking { db.referenceDao().getFacility("f-otp") })

            runBlocking { db.referenceDao().replaceFacilities(listOf(store)) }
            assertEquals("Replace must drop facilities the user no longer sees", 1, runBlocking { db.referenceDao().countFacilities() })
        } finally {
            db.close()
        }
    }

    /** v10→v11 adds the stock caches (StockEntities.kt, web migration 0101). Brand-new,
     *  server-derived tables; checks they round-trip through StockDao, including the
     *  facility-stock swap that must drop what the server no longer returns. */
    @Test
    fun migrate10To11_createsStockCacheTables() {
        helper.createDatabase(testDb, 10).apply { close() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_10_11)
            .build()
        try {
            val dao = db.stockDao()
            runBlocking {
                dao.replaceCatalogue(listOf(ProductRefEntity("p1", "RUTF 92 g", 150)), listOf(LotRefEntity("l1", "p1", "A-1", "2027-01-31")))
                dao.replaceFacilityStock(
                    balances = listOf(StockBalanceEntity("f1", "l1", "l1", 300, 1L)),
                    transfers = listOf(IncomingTransferEntity("t1", "TRF-1", "f0", "f1", "2026-10-01", 300, null)),
                    lines = listOf(IncomingTransferLineEntity("t1", 1, "l1", 300)),
                    dispensingDays = listOf(DispensingDayEntity("f1", "2026-10-01")),
                )
            }
            assertEquals(1, runBlocking { dao.getTransferLines("t1") }.size)
            assertEquals(true, runBlocking { dao.isDispensingDayRecorded("f1", "2026-10-01") })

            runBlocking { dao.replaceFacilityStock(emptyList(), emptyList(), emptyList(), emptyList()) }
            assertEquals("Swap must drop transfers no longer in transit", 0, runBlocking { dao.getTransferLines("t1") }.size)
        } finally {
            db.close()
        }
    }

    /** v11→v12 adds the supervision caches (web migration 0103): LGAs, OTP dispensing, pending
     *  adjustments — round-trips them and the swap that replaces a supervisor's whole cache. */
    @Test
    fun migrate11To12_createsSupervisionCacheTables() {
        helper.createDatabase(testDb, 11).apply { close() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, TpmDatabase::class.java, testDb)
            .addMigrations(MIGRATION_11_12)
            .build()
        try {
            val dao = db.stockDao()
            runBlocking {
                dao.replaceSupervision(
                    lgas = listOf(SupervisorLgaEntity("lga-1")),
                    balances = listOf(StockBalanceEntity("f1", "l1", "l1", 500, 1L)),
                    dispensing = listOf(OtpDispensingEntity("f1", "2026-09-01", 2, 120)),
                    adjustments = listOf(PendingAdjustmentEntity("a1", "f1", "2026-09-30", "l1", -5, "count shortfall")),
                )
            }
            assertEquals(120, runBlocking { dao.getOtpDispensing("f1", "2026-09-01", "2026-09-30") }.sumOf { it.sachetsDispensed })
            assertEquals(500, runBlocking { dao.getBalances("f1") }.single().balance)
            runBlocking { dao.replaceSupervision(emptyList(), emptyList(), emptyList(), emptyList()) }
            assertEquals(0, runBlocking { dao.getBalances("f1") }.size)
        } finally {
            db.close()
        }
    }
}
