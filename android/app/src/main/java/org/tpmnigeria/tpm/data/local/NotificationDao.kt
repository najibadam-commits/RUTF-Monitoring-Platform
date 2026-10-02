package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import org.tpmnigeria.tpm.domain.model.UserRole

@Dao
interface NotificationDao {
    @Query("SELECT * FROM notifications WHERE role = :role ORDER BY timestampMillis DESC")
    fun observeForRole(role: UserRole): Flow<List<NotificationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: NotificationEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(notifications: List<NotificationEntity>)

    /** Used for pulled-from-remote rows — silently skips ones already inserted by a previous
     *  pull (unique index on remoteId; see NotificationEntity). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnoringDuplicates(notifications: List<NotificationEntity>)

    @Query("UPDATE notifications SET unread = 0 WHERE id = :id")
    suspend fun markRead(id: Long)

    @Query("SELECT COUNT(*) FROM notifications")
    suspend fun count(): Int
}
