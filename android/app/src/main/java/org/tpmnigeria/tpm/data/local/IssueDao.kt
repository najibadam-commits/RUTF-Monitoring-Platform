package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface IssueDao {
    @Query("SELECT * FROM issues ORDER BY dateReported DESC")
    fun observeAll(): Flow<List<IssueEntity>>

    @Query("SELECT * FROM issues WHERE id = :id")
    suspend fun getById(id: String): IssueEntity?

    @Query("SELECT * FROM issues WHERE id = :id")
    fun observeById(id: String): Flow<IssueEntity?>

    @Query("SELECT * FROM issues WHERE UPPER(id) = UPPER(:id) LIMIT 1")
    suspend fun findByIdCaseInsensitive(id: String): IssueEntity?

    @Query("SELECT * FROM issues WHERE remoteId = :remoteId")
    suspend fun getByRemoteId(remoteId: String): IssueEntity?

    @Query("SELECT COUNT(*) FROM issues")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(issues: List<IssueEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(issue: IssueEntity)

    @Update
    suspend fun update(issue: IssueEntity)

    /** Deletes local rows for a synced Finding that no longer appears in a full, RLS-scoped id
     *  sweep of what this account can currently see — see SupabaseSyncApiService.pullIssues'
     *  reconciliation pass / DECISIONS.md #27. [remoteId] IS NOT NULL is the whole safety net: a
     *  local-only unsynced draft (remoteId still null) is never touched here regardless of what
     *  the server currently shows, since it hasn't been pushed yet and isn't "on the server" to
     *  compare against in the first place.
     *
     *  Deliberately not called directly with a possibly-empty list — Room/SQLite's handling of
     *  `NOT IN ()` for an empty collection parameter isn't something to rely on for a query this
     *  security-relevant; see [deleteAllSynced] and the branch in AppRepository.pruneStaleIssues. */
    @Query("DELETE FROM issues WHERE remoteId IS NOT NULL AND remoteId NOT IN (:visibleRemoteIds)")
    suspend fun deleteSyncedNotIn(visibleRemoteIds: List<String>)

    /** The empty-set case of [deleteSyncedNotIn]: nothing is currently visible to this account,
     *  so every previously-synced local row should go — a brand-new DRI with no assignments yet
     *  legitimately has nothing to show, same as one who's been reassigned away from everything. */
    @Query("DELETE FROM issues WHERE remoteId IS NOT NULL")
    suspend fun deleteAllSynced()
}
