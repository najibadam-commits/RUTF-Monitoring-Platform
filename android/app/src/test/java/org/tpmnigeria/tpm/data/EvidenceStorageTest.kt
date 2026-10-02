package org.tpmnigeria.tpm.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.tpmnigeria.tpm.data.remote.EvidenceStorage

class EvidenceStorageTest {
    private val path = "0d6f4e2a-1b2c-4d3e-8f90-aabbccddeeff/discovery_mov.jpg"

    @Test
    fun referenceRoundTripsToTheStoragePath() {
        assertEquals(path, EvidenceStorage.storagePathOf(EvidenceStorage.reference(path)))
    }

    @Test
    fun deadPublicUrlsFromOlderBuildsAreHealedToTheirStoragePath() {
        val legacy = "https://xnhyhyxofnkopzjlfvgs.supabase.co/storage/v1/object/public/issue-evidence/$path"
        assertEquals(path, EvidenceStorage.storagePathOf(legacy))
        assertEquals(path, EvidenceStorage.storagePathOf("$legacy?t=123"))
    }

    @Test
    fun localCameraFilesAndForeignUrlsAreNotTreatedAsStoragePhotos() {
        assertNull(EvidenceStorage.storagePathOf(null))
        assertNull(EvidenceStorage.storagePathOf("/data/user/0/org.tpmnigeria.tpm/files/mov_123.jpg"))
        assertNull(EvidenceStorage.storagePathOf("https://example.com/some/other/image.jpg"))
        // A different bucket's public URL is not ours to sign.
        assertNull(EvidenceStorage.storagePathOf("https://x.supabase.co/storage/v1/object/public/attendance-evidence/a/b.jpg"))
    }
}
