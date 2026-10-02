package org.tpmnigeria.tpm.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Real Room migrations, replacing the `fallbackToDestructiveMigration()` that used to sit in
 * TpmDatabase — that call silently wiped the entire local database (every unsynced issue, every
 * pending sync_queue row) on any version bump. It was fine while true ("pre-launch — no installed
 * base with real data to preserve yet"), but that stops being true the moment this ships to a
 * field device, so it's being removed now, before that happens — see the production-stabilization
 * audit.
 *
 * Derived by diffing app/schemas/org.tpmnigeria.tpm.data.local.TpmDatabase/{3,4,5,6}.json against
 * each other and against the current entity classes (7 was never exported — the version bump to 7
 * landed without triggering a fresh KSP schema-export pass). That diff showed:
 *   - v3 → v4 → v5: byte-identical schema (same identityHash in all three exported files) — these
 *     version bumps happened without any actual column/table change, so nothing to migrate.
 *   - v5 → v6: `issues` gained the nullable `locationOther` column (the merged Settlement/Activity
 *     Site picker's manual-fallback text field).
 *   - v6 → v7: `sync_queue` gained `retryCount INTEGER NOT NULL DEFAULT 0` (see SyncQueueDao's
 *     recordFailedAttempt/resetForRetry) — confirmed by comparing 6.json's sync_queue createSql
 *     against SyncQueueEntity.kt's current fields, which is otherwise identical.
 * Every step here is additive (ADD COLUMN) or a genuine no-op — the safest category of migration;
 * none of them drop or rewrite a table that holds field data. See MigrationTest (androidTest) for
 * an instrumented test that exercises this exact chain against real inserted rows — I could not
 * run it myself (no working Gradle/instrumentation in this environment); run it in Android Studio
 * before relying on this in production.
 */
val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // No schema change between v3 and v4 (identical identityHash in the exported schemas).
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // No schema change between v4 and v5 (identical identityHash in the exported schemas).
    }
}

val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE issues ADD COLUMN locationOther TEXT")
    }
}

val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE sync_queue ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0")
    }
}

/** Structured mobile_code restyle (see IssueIdGenerator) to match the web's LGA3-WARD3-CAT3-YY-
 *  INITIALS### convention (web migration 0026): `abbr` on the three reference-lookup tables that
 *  supply it, plus a new local counter table backing the numeric suffix. All additive/new — the
 *  ref_* tables are pure server-derived caches (ReferenceRepository repopulates them; nothing
 *  here holds field data that could be lost), and issue_id_counters is a brand-new table. */
val MIGRATION_7_8 = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE ref_lgas ADD COLUMN abbr TEXT")
        db.execSQL("ALTER TABLE ref_wards ADD COLUMN abbr TEXT")
        db.execSQL("ALTER TABLE ref_categories ADD COLUMN abbr TEXT")
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS issue_id_counters (
                `prefix` TEXT NOT NULL, `year` INTEGER NOT NULL, `initials` TEXT NOT NULL,
                `lastNumber` INTEGER NOT NULL, PRIMARY KEY(`prefix`, `year`, `initials`))""",
        )
    }
}

/** New `attendance_records` table backing Daily Attendance (Items 9-15 — see AttendanceEntity,
 *  DECISIONS.md #24 in the web project). Brand-new table, nothing to preserve from a prior
 *  version — purely additive. */
val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS attendance_records (
                `localId` TEXT NOT NULL, `remoteId` TEXT, `fieldMonitorId` TEXT NOT NULL,
                `attendanceDate` TEXT NOT NULL, `capturedAtMillis` INTEGER NOT NULL,
                `lat` REAL NOT NULL, `lng` REAL NOT NULL, `gpsAccuracyM` INTEGER NOT NULL,
                `selfiePhotoPath` TEXT NOT NULL, `assignmentLocationPhotoPath` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL, PRIMARY KEY(`localId`))""",
        )
    }
}

/** New `ref_facilities` cache (RUTF facility registry, web migration 0100 — see
 *  FacilityRefEntity). A server-derived cache like the other ref_* tables: brand-new and purely
 *  additive, ReferenceRepository fills it on the next refresh. */
val MIGRATION_9_10 = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS ref_facilities (
                `id` TEXT NOT NULL, `name` TEXT NOT NULL, `facilityType` TEXT NOT NULL,
                `lgaId` TEXT NOT NULL, `wardId` TEXT, `lat` REAL, `lng` REAL,
                `isOtpSite` INTEGER NOT NULL, `suppliedById` TEXT, PRIMARY KEY(`id`))""",
        )
    }
}

/** Stock recording caches (web migration 0101 — see StockEntities.kt): products, lots, the
 *  facility's balances, incoming transfers + their lines, recorded dispensing days. All new,
 *  server-derived tables that StockRepository.refresh fills — purely additive. */
val MIGRATION_10_11 = object : Migration(10, 11) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_products` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `unitsPerCarton` INTEGER NOT NULL, PRIMARY KEY(`id`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_lots` (`id` TEXT NOT NULL, `productId` TEXT NOT NULL, `lotNo` TEXT NOT NULL, `expiryDate` TEXT NOT NULL, PRIMARY KEY(`id`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_stock_balances` (`facilityId` TEXT NOT NULL, `lotKey` TEXT NOT NULL, `lotId` TEXT, `balance` INTEGER NOT NULL, `refreshedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`facilityId`, `lotKey`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_incoming_transfers` (`id` TEXT NOT NULL, `code` TEXT, `fromFacilityId` TEXT NOT NULL, `toFacilityId` TEXT NOT NULL, `issuedDate` TEXT NOT NULL, `sachetsIssued` INTEGER NOT NULL, `documentNo` TEXT, PRIMARY KEY(`id`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_incoming_transfer_lines` (`transferId` TEXT NOT NULL, `lineNo` INTEGER NOT NULL, `lotId` TEXT, `quantity` INTEGER NOT NULL, PRIMARY KEY(`transferId`, `lineNo`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `ref_dispensing_days` (`facilityId` TEXT NOT NULL, `dispenseDate` TEXT NOT NULL, PRIMARY KEY(`facilityId`, `dispenseDate`))")
    }
}

val ALL_MIGRATIONS = arrayOf(MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11)
