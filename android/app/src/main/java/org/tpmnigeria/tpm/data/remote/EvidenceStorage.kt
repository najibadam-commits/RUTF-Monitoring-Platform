package org.tpmnigeria.tpm.data.remote

import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.CancellationException
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.hours

/**
 * Remote evidence photos live in the PRIVATE `issue-evidence` bucket, so a `publicUrl(...)` link
 * (what this app used to store) always answers 400 "Bucket not found" — photos taken on *another*
 * device never displayed, which is exactly the case for a DRI viewing a Field Monitor's evidence or
 * a senior officer reviewing anyone's. The web app already uses signed URLs; this does the same.
 *
 * What is persisted in Room for a remote photo is a stable reference ([reference]), not a URL,
 * because a signed URL expires. The Finding detail screen turns the reference into a fresh signed
 * URL when it is actually shown ([signedUrl]) — issued through the signed-in session, so the
 * bucket's own RLS (`issue-evidence select`) still decides who can see what.
 */
object EvidenceStorage {
    private const val REFERENCE_PREFIX = "storage:"
    private const val LEGACY_PUBLIC_MARKER = "/storage/v1/object/public/$ISSUE_EVIDENCE_BUCKET/"
    private val SIGNED_URL_LIFETIME = 1.hours
    private const val REUSE_FOR_MILLIS = 50L * 60 * 1000 // stay comfortably inside the lifetime

    private class Signed(val url: String, val atMillis: Long)
    private val cache = ConcurrentHashMap<String, Signed>()

    /** The value to store for a photo that lives in Storage at [storagePath]. */
    fun reference(storagePath: String): String = REFERENCE_PREFIX + storagePath

    /**
     * The Storage path behind a stored photo value, or null if it is not a remote photo (a local
     * file path from this device's own camera, or some other URL). Also understands the dead
     * `.../object/public/issue-evidence/<path>` URLs older builds cached in Room, so an existing
     * install heals without a re-sync.
     */
    fun storagePathOf(stored: String?): String? = when {
        stored == null -> null
        stored.startsWith(REFERENCE_PREFIX) -> stored.removePrefix(REFERENCE_PREFIX)
        stored.startsWith("http") && LEGACY_PUBLIC_MARKER in stored ->
            stored.substringAfter(LEGACY_PUBLIC_MARKER).substringBefore('?')
        else -> null
    }

    /** A fresh signed URL for [storagePath], or null when it can't be obtained (offline, no access). */
    suspend fun signedUrl(storagePath: String): String? {
        val now = System.currentTimeMillis()
        cache[storagePath]?.let { if (now - it.atMillis < REUSE_FOR_MILLIS) return it.url }
        return try {
            val url = Supabase.client.storage.from(ISSUE_EVIDENCE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_LIFETIME)
            cache[storagePath] = Signed(url, now)
            url
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }
}
