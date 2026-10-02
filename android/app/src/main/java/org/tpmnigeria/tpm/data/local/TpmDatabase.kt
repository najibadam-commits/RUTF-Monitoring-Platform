package org.tpmnigeria.tpm.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        IssueEntity::class, NotificationEntity::class, SyncQueueEntity::class,
        StateRefEntity::class, LgaRefEntity::class, WardRefEntity::class, CategoryRefEntity::class,
        SettlementRefEntity::class, ActivitySiteRefEntity::class, LoadedScopeEntity::class,
        IssueIdCounterEntity::class, AttendanceEntity::class, FacilityRefEntity::class,
    ],
    version = 10,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class TpmDatabase : RoomDatabase() {
    abstract fun issueDao(): IssueDao
    abstract fun notificationDao(): NotificationDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun referenceDao(): ReferenceDao
    abstract fun issueIdCounterDao(): IssueIdCounterDao
    abstract fun attendanceDao(): AttendanceDao

    companion object {
        @Volatile private var INSTANCE: TpmDatabase? = null

        fun getInstance(context: Context): TpmDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    TpmDatabase::class.java,
                    "tpm.db",
                )
                    // Real migrations (see Migrations.kt) — a field device's unsynced issues and
                    // pending sync_queue rows must survive a schema upgrade, not get silently
                    // wiped by fallbackToDestructiveMigration() on the next app update.
                    .addMigrations(*ALL_MIGRATIONS)
                    .build().also { INSTANCE = it }
            }
    }
}
