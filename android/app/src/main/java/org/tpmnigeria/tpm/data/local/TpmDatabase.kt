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
        IssueIdCounterEntity::class, FacilityRefEntity::class,
        ProductRefEntity::class, LotRefEntity::class, StockBalanceEntity::class,
        IncomingTransferEntity::class, IncomingTransferLineEntity::class, DispensingDayEntity::class,
        SupervisorLgaEntity::class, OtpDispensingEntity::class, PendingAdjustmentEntity::class,
    ],
    version = 13,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class TpmDatabase : RoomDatabase() {
    abstract fun issueDao(): IssueDao
    abstract fun notificationDao(): NotificationDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun referenceDao(): ReferenceDao
    abstract fun issueIdCounterDao(): IssueIdCounterDao
    abstract fun stockDao(): StockDao

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
