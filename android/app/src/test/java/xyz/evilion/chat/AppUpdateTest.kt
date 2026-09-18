package xyz.evilion.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.evilion.chat.data.AppUpdate

/**
 * Which build a phone is offered.
 *
 * The universal APK is about 39 MB and the per-processor ones are a third of
 * that, so getting this wrong costs every update more than twice what it is
 * worth — and getting it wrong in the other direction offers a phone a build it
 * cannot run at all.
 */
class AppUpdateTest {
    private val release = AppUpdate.Release(
        version = "1.0.3",
        versionCode = 4,
        name = "nexa-1.0.3.apk",
        size = 41_000_000,
        sha256 = "aa",
        files = listOf(
            AppUpdate.Variant("universal", "nexa-1.0.3.apk", 41_000_000, "aa"),
            AppUpdate.Variant("arm64-v8a", "nexa-1.0.3-arm64-v8a.apk", 16_000_000, "bb"),
            AppUpdate.Variant("armeabi-v7a", "nexa-1.0.3-armeabi-v7a.apk", 11_000_000, "cc"),
        ),
    )

    @Test
    fun `takes the first processor the phone prefers`() {
        // a 64-bit phone that can also run 32-bit code lists the 64-bit one first
        val picked = AppUpdate.variantFor(release, arrayOf("arm64-v8a", "armeabi-v7a"))
        assertEquals("arm64-v8a", picked.abi)
        assertEquals(16_000_000, picked.size)
    }

    @Test
    fun `falls back to the next one it can actually run`() {
        assertEquals("armeabi-v7a", AppUpdate.variantFor(release, arrayOf("armeabi-v7a")).abi)
    }

    @Test
    fun `takes the one that runs anywhere when it knows nothing better`() {
        assertEquals("universal", AppUpdate.variantFor(release, arrayOf("mips")).abi)
    }

    @Test
    fun `a server that lists no builds still offers the flat one`() {
        val flat = release.copy(files = emptyList())
        val picked = AppUpdate.variantFor(flat, arrayOf("arm64-v8a"))
        assertEquals("nexa-1.0.3.apk", picked.name)
        assertEquals(flat.sha256, picked.sha256)
    }

    @Test
    fun `newer means a higher version code, not a different name`() {
        assertTrue(AppUpdate.isNewer(release.copy(versionCode = BuildConfig.VERSION_CODE + 1)))
        assertFalse(AppUpdate.isNewer(release.copy(versionCode = BuildConfig.VERSION_CODE)))
        assertFalse(AppUpdate.isNewer(release.copy(versionCode = BuildConfig.VERSION_CODE - 1, version = "9.9.9")))
    }
}
