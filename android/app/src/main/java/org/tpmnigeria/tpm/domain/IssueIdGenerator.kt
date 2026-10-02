package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.data.local.IssueIdCounterDao
import java.time.Year

/**
 * Structured mobile_code, restyled to match the web's issue-code convention (web migration
 * 0026, DECISIONS.md #11): `LGA3-WARD3-CAT3-YY-INITIALS###`, e.g. `KMC-NAS-WSF-26-NI001` — this
 * is `issues.mobile_code` server-side (a real, permanent column, migration 0016), not just
 * cosmetic, and remains a wholly separate scheme from `issues.code` (the server's own structured
 * ID, generated independently once the issue syncs — the two will never be identical, by design;
 * see Issue.kt's kdoc).
 *
 * The three abbreviation segments come from ReferenceRepository's cached lga/ward/category rows
 * (their `abbr` column, sourced from Supabase — see ReferenceEntities.kt) and fall back to `GEN`
 * when not yet known locally (e.g. this device hasn't been online since picking up the `abbr`
 * column, or the LGA/ward came from the bundled offline asset and hasn't been abbr-enriched
 * yet) — matching the server's own `generate_issue_id()` fallback for a null lookup. `INITIALS`
 * is derived from the reporter's name via [deriveInitials], the same algorithm as the server's
 * `derive_initials()`, so the two independently arrive at the same two letters for the same name.
 *
 * The numeric suffix comes from a local, per-device counter (see IssueIdCounterEntity) — this is
 * NOT the same counter the server uses for `issues.code`; a device generates mobile_code offline,
 * before the server is even reachable, so there's no way to share one sequence across devices.
 * Two different devices can legitimately land on the same suffix for the same prefix+year+
 * initials; AppRepository's existing retry-with-a-fresh-id-on-unique-constraint-violation at
 * sync time is what actually guarantees `issues.mobile_code` uniqueness, same safety net as
 * before this restyle (it previously covered a random 6-digit suffix's rare collisions instead).
 */
suspend fun generateStructuredIssueId(
    counterDao: IssueIdCounterDao,
    lgaAbbr: String?,
    wardAbbr: String?,
    categoryAbbr: String?,
    reporterName: String,
    year: Int = Year.now().value,
): String {
    val lga3 = (lgaAbbr?.takeIf { it.isNotBlank() } ?: "GEN").uppercase()
    val ward3 = (wardAbbr?.takeIf { it.isNotBlank() } ?: "GEN").uppercase()
    val cat3 = (categoryAbbr?.takeIf { it.isNotBlank() } ?: "GEN").uppercase()
    val initials = deriveInitials(reporterName)
    val yy = (year % 100).toString().padStart(2, '0')
    val prefix = "$lga3-$ward3-$cat3"

    val seq = counterDao.nextSequence(prefix, year, initials)
    return "$prefix-$yy-$initials${seq.toString().padStart(3, '0')}"
}

/** Mirrors the server's `derive_initials()` exactly (web migration 0026): first letter of the
 *  first name-token + first letter of the last name-token; a single-word name doubles its first
 *  letter; "XX" for an empty/blank name. Kept in sync deliberately so a mobile-generated ID's
 *  INITIALS segment reads the same as what the server would independently derive for the same
 *  reporter, even though the two are computed completely separately. */
fun deriveInitials(name: String): String {
    val tokens = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    if (tokens.isEmpty()) return "XX"
    val first = tokens.first().first().uppercaseChar()
    val last = tokens.last().first().uppercaseChar()
    return "$first$last"
}
