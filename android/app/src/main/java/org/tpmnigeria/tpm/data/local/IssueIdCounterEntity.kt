package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

/**
 * Local, per-device mirror of the server's `issue_id_counters` table (web migration 0026) —
 * backs the structured mobile_code's numeric suffix (see IssueIdGenerator). Scoped by
 * (prefix, year, initials) exactly like the server's version, for the same reason: two
 * different reporters (or the same reporter in a different LGA/ward/category) never share a
 * bucket, but two reporters who happen to share initials do (a deliberate characteristic of the
 * requested format, not a bug — see DECISIONS.md #11 in the web project).
 *
 * This is intentionally a *separate* counter from the server's — a device generates mobile_code
 * offline, before the server has any say in the matter, so there's no way to share a single
 * sequence across devices without a network round-trip (which would defeat the point of an
 * offline-first ID). Because of that, two different devices can legitimately produce the same
 * numeric suffix for the same prefix+year+initials; mobile_code's actual uniqueness guarantee
 * comes from AppRepository's existing retry-with-a-fresh-id-on-conflict safety net at sync time,
 * same as before this format change — this counter only makes the *common* case look like a
 * clean, non-repeating local sequence instead of a random number.
 */
@Entity(tableName = "issue_id_counters", primaryKeys = ["prefix", "year", "initials"])
data class IssueIdCounterEntity(
    val prefix: String,
    val year: Int,
    val initials: String,
    val lastNumber: Int,
)

@Dao
interface IssueIdCounterDao {
    @Query("SELECT lastNumber FROM issue_id_counters WHERE prefix = :prefix AND year = :year AND initials = :initials")
    suspend fun getLastNumber(prefix: String, year: Int, initials: String): Int?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: IssueIdCounterEntity)

    /** Atomically claims and returns the next sequence number for this bucket. Room serializes
     *  writes to a single connection, so read-then-write here is safe from a lost-update race
     *  the same way the rest of this single-device app already relies on that guarantee. */
    @Transaction
    suspend fun nextSequence(prefix: String, year: Int, initials: String): Int {
        val next = (getLastNumber(prefix, year, initials) ?: 0) + 1
        upsert(IssueIdCounterEntity(prefix, year, initials, next))
        return next
    }
}
