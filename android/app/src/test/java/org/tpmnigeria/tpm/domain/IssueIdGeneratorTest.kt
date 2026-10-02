package org.tpmnigeria.tpm.domain

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tpmnigeria.tpm.data.local.IssueIdCounterDao
import org.tpmnigeria.tpm.data.local.IssueIdCounterEntity

/** Simple in-memory stand-in for the Room-generated DAO — a real one needs an instrumented test
 *  (device/emulator); this exercises the exact same nextSequence() contract without one. */
private class FakeIssueIdCounterDao : IssueIdCounterDao {
    private val counters = mutableMapOf<Triple<String, Int, String>, Int>()

    override suspend fun getLastNumber(prefix: String, year: Int, initials: String): Int? =
        counters[Triple(prefix, year, initials)]

    override suspend fun upsert(entity: IssueIdCounterEntity) {
        counters[Triple(entity.prefix, entity.year, entity.initials)] = entity.lastNumber
    }
}

class IssueIdGeneratorTest {

    @Test
    fun `generated id has the structured format`() = runBlocking {
        val id = generateStructuredIssueId(
            FakeIssueIdCounterDao(), lgaAbbr = "kmc", wardAbbr = "nas", categoryAbbr = "wsf",
            reporterName = "Najib Isah", year = 2026,
        )
        assertEquals("KMC-NAS-WSF-26-NI001", id)
    }

    @Test
    fun `missing abbreviations fall back to GEN, matching the server`() = runBlocking {
        val id = generateStructuredIssueId(
            FakeIssueIdCounterDao(), lgaAbbr = null, wardAbbr = null, categoryAbbr = null,
            reporterName = "Najib Isah", year = 2026,
        )
        assertEquals("GEN-GEN-GEN-26-NI001", id)
    }

    @Test
    fun `sequence increments per prefix+year+initials bucket, independently of other buckets`() = runBlocking {
        val dao = FakeIssueIdCounterDao()
        val first = generateStructuredIssueId(dao, "KMC", "NAS", "WSF", "Najib Isah", 2026)
        val second = generateStructuredIssueId(dao, "KMC", "NAS", "WSF", "Najib Isah", 2026)
        val differentBucket = generateStructuredIssueId(dao, "KMC", "NAS", "INF", "Najib Isah", 2026)

        assertEquals("KMC-NAS-WSF-26-NI001", first)
        assertEquals("KMC-NAS-WSF-26-NI002", second)
        assertEquals("KMC-NAS-INF-26-NI001", differentBucket) // different category prefix -> its own 001
    }

    @Test
    fun `derives initials the same way the server does`() {
        assertEquals("NI", deriveInitials("Najib Isah"))
        assertEquals("NI", deriveInitials("Najib Abdullahi Isah")) // first + last token only (web 0042)
        assertEquals("JJ", deriveInitials("Jide")) // single word doubles its first letter
        assertEquals("XX", deriveInitials(""))
        assertEquals("XX", deriveInitials("   "))
    }

    @Test
    fun `generated ids are unique across many sequential submissions`() = runBlocking {
        val dao = FakeIssueIdCounterDao()
        val count = 100
        val ids = (1..count).map {
            generateStructuredIssueId(dao, "KMC", "NAS", "WSF", "Najib Isah", 2026)
        }.toSet()
        assertTrue("Generated $count IDs should be unique", ids.size == count)
    }
}
