package org.tpmnigeria.tpm.domain

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

/**
 * Downscales+recompresses [file] (an evidence photo written raw by CameraX — see
 * CameraCaptureModal) in place, so what sits on disk pending sync — and what a background upload
 * eventually sends over often-poor field connectivity — is a fraction of the multi-megabyte
 * original a modern phone camera produces. Call this off the main thread (CameraX's
 * OnImageSavedCallback runs on the main executor).
 *
 * Two-pass decode (bounds first, then a sampled full decode) so a large capture never needs its
 * full-resolution bitmap in memory at once. Writes to a sibling temp file and renames over the
 * original only once the re-encode fully succeeds, so a crash or low-memory kill mid-compression
 * can never leave a truncated/corrupt evidence photo behind.
 */
fun compressImageFileInPlace(
    file: File,
    maxDimensionPx: Int = 1600,
    jpegQuality: Int = 80,
) {
    if (!file.exists()) return

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return // Not a decodable image; leave as-is.

    var sampleSize = 1
    while (bounds.outWidth / (sampleSize * 2) >= maxDimensionPx && bounds.outHeight / (sampleSize * 2) >= maxDimensionPx) {
        sampleSize *= 2
    }

    val sampled = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sampleSize })
        ?: return // Decode failed (corrupt file, out of memory) — leave the original untouched.

    try {
        val scale = maxDimensionPx.toFloat() / maxOf(sampled.width, sampled.height)
        val resized = if (scale < 1f) {
            Bitmap.createScaledBitmap(sampled, (sampled.width * scale).toInt().coerceAtLeast(1), (sampled.height * scale).toInt().coerceAtLeast(1), true)
        } else {
            sampled
        }

        val tempFile = File(file.parentFile, "${file.name}.compressing")
        FileOutputStream(tempFile).use { out -> resized.compress(Bitmap.CompressFormat.JPEG, jpegQuality, out) }
        if (resized !== sampled) resized.recycle()

        if (!tempFile.renameTo(file)) {
            // Fall back to a copy if rename failed (e.g. cross-filesystem) rather than losing the
            // compressed result entirely.
            tempFile.copyTo(file, overwrite = true)
            tempFile.delete()
        }
    } finally {
        sampled.recycle()
    }
}
