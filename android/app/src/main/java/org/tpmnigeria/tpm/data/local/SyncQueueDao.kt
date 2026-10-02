package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import org.tpmnigeria.tpm.domain.model.SyncStatus

@Dao
interface SyncQueueDao {
    @Query("SELECT * FROM sync_queue ORDER BY timestampMillis DESC")
    fun observeAll(): Flow<List<SyncQueueEntity>>

    @Query("SELECT * FROM sync_queue WHERE status = :status")
    suspend fun getByStatus(status: SyncStatus): List<SyncQueueEntity>

    /** Counts anything not yet successfully synced (Pending or Failed) — the Home/nav banner's
     *  point is "this many things still need attention," and a Failed row needs it more than a
     *  Pending one, not less. Only ever called with the default; not parameterized for a caller
     *  that doesn't exist. */
    @Query("SELECT COUNT(*) FROM sync_queue WHERE status != 'Synced'")
    fun observePendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: SyncQueueEntity)

    @Query("UPDATE sync_queue SET status = :status WHERE localId = :localId")
    suspend fun updateStatus(localId: String, status: SyncStatus)

    @Query("UPDATE sync_queue SET status = :status WHERE status != :status")
    suspend fun markAll(status: SyncStatus)

    /** Bumps retryCount and, once it reaches [maxRetries], flips status to Failed so
     *  pendingSyncItemsOldestFirst() stops picking it up — see SyncWorker. Below that threshold it
     *  stays Pending so WorkManager's own retry/backoff keeps giving it a chance; this only caps a
     *  chronically-failing item so it can't retry forever and it becomes visible as Failed. */
    @Query("""
        UPDATE sync_queue SET retryCount = retryCount + 1,
            status = CASE WHEN retryCount + 1 >= :maxRetries THEN 'Failed' ELSE status END
        WHERE localId = :localId
    """)
    suspend fun recordFailedAttempt(localId: String, maxRetries: Int)

    /** User-initiated "Retry" on a Failed row — resets it back to Pending with a clean retry
     *  count, same as if it were a fresh submission. */
    @Query("UPDATE sync_queue SET status = 'Pending', retryCount = 0 WHERE localId = :localId")
    suspend fun resetForRetry(localId: String)
}
