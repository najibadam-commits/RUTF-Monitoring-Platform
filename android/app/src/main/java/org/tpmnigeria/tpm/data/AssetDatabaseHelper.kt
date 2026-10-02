package org.tpmnigeria.tpm.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.io.FileOutputStream

/**
 * Utility to read from the read-only reference SQLite files in assets (state.sqlite,
 * LGA.sqlite, Ward.sqlite) to populate the main Room database.
 */
class AssetDatabaseHelper(private val context: Context) {

    fun <T> useDatabase(assetName: String, block: (SQLiteDatabase) -> T): T {
        val dbFile = File(context.cacheDir, assetName)
        
        // Copy asset to cacheDir if it doesn't exist.
        // NOTE: In production, you might want to check versions or sizes to update.
        if (!dbFile.exists()) {
            try {
                context.assets.open(assetName).use { input ->
                    FileOutputStream(dbFile).use { output ->
                        input.copyTo(output)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("AssetDatabaseHelper", "Failed to copy asset $assetName", e)
                throw e
            }
        }

        val db = try {
            SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        } catch (e: Exception) {
            android.util.Log.e("AssetDatabaseHelper", "Failed to open database $assetName at ${dbFile.absolutePath}", e)
            dbFile.delete() // Delete corrupted file so it's re-copied next time
            throw e
        }
        return try {
            block(db)
        } finally {
            db.close()
        }
    }

    /** Find a table name in the database among possible candidates. */
    fun findTableName(db: SQLiteDatabase, candidates: List<String>): String? {
        candidates.forEach { name ->
            db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name=?", arrayOf(name)).use {
                if (it.moveToFirst()) return name
            }
        }
        // Fallback: just pick the first table that isn't sqlite_sequence/android_metadata
        db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'android_metadata'", null).use {
            if (it.moveToFirst()) return it.getString(0)
        }
        return null
    }

    /** Find a column name in the cursor among possible candidates (case-insensitive). */
    fun findColumnIndex(cursor: Cursor, candidates: List<String>): Int {
        candidates.forEach { name ->
            val idx = cursor.getColumnIndex(name)
            if (idx != -1) return idx
        }
        // Try case-insensitive manually if getColumnIndex fails
        for (i in 0 until cursor.columnCount) {
            val colName = cursor.getColumnName(i)
            if (candidates.any { it.equals(colName, ignoreCase = true) }) return i
        }
        return -1
    }
}
