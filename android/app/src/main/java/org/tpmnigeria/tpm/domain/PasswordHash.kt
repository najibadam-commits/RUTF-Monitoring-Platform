package org.tpmnigeria.tpm.domain

import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Local-only credential check for offline re-entry — see AppSession's offline sign-in path. Never
 * stores or compares the real Supabase Auth password; this only lets the app verify, without a
 * network call, that whoever is typing on this device still knows the password that was correct
 * the last time it *did* successfully authenticate online. That's what turns "cached login" from
 * an outright bypass (any password + a matching cached email used to work — see the
 * production-stabilization audit) into an actual, if locally-scoped, credential check.
 *
 * PBKDF2WithHmacSHA256 is used because it's built into the Android/JVM standard library (no extra
 * dependency) and is the standard choice for this kind of local verification.
 */
object PasswordHash {
    private const val ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val ITERATIONS = 120_000
    private const val KEY_LENGTH_BITS = 256
    private const val SALT_LENGTH_BYTES = 16

    data class Hashed(val hash: String, val salt: String, val iterations: Int)

    /** Call once, right after a real online sign-in succeeds (the password is known-correct at
     *  that moment because Supabase Auth just accepted it). */
    fun hash(password: String): Hashed {
        val salt = ByteArray(SALT_LENGTH_BYTES).also { SecureRandom().nextBytes(it) }
        val digest = pbkdf2(password, salt, ITERATIONS)
        return Hashed(hash = digest.toHex(), salt = salt.toHex(), iterations = ITERATIONS)
    }

    /** Constant-time-ish comparison (via MessageDigest.isEqual) of a freshly-typed password
     *  against a previously stored [Hashed]. */
    fun verify(password: String, stored: Hashed): Boolean {
        val salt = stored.salt.fromHex() ?: return false
        val expected = stored.hash.fromHex() ?: return false
        val actual = pbkdf2(password, salt, stored.iterations)
        return java.security.MessageDigest.isEqual(actual, expected)
    }

    private fun pbkdf2(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, KEY_LENGTH_BITS)
        return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).encoded
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.fromHex(): ByteArray? {
        if (length % 2 != 0) return null
        return try {
            ByteArray(length / 2) { i -> ((this[i * 2].digitToInt(16) shl 4) + this[i * 2 + 1].digitToInt(16)).toByte() }
        } catch (e: NumberFormatException) {
            null
        }
    }
}
