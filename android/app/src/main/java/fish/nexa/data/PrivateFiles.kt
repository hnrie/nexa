package fish.nexa.data

import fish.nexa.Nexa
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/**
 * lib/bugMedia.ts: the files of case threads and bug reports, which only their
 * member and the staff may fetch. They need the account's token, which a
 * picture address cannot carry, so they are fetched here into the app's own
 * cache, kept a little while (24 at most) and cleared on sign-out.
 */
object PrivateFiles {
    private const val KEEP = 24
    private val lock = Mutex()

    private fun dir(): File = File(Nexa.app.cacheDir, "private").apply { mkdirs() }

    /** A local copy of /media/{kind}/{id} (a smaller one with [size]), fetched once. */
    suspend fun file(kind: String, id: String, size: Int? = null): File = lock.withLock {
        val f = File(dir(), "$kind-$id" + (size?.let { "@$it" } ?: ""))
        if (f.exists() && f.length() > 0) {
            f.setLastModified(System.currentTimeMillis())
            return@withLock f
        }
        withContext(Dispatchers.IO) {
            val path = "/media/$kind/$id" + (size?.let { "?size=$it" } ?: "")
            val req = Nexa.api.requestBuilder(path).get().build()
            val res = Nexa.api.http.newCall(req).execute()
            res.use { r ->
                if (!r.isSuccessful) throw IOException("${r.code}")
                val tmp = File(f.path + ".part")
                tmp.outputStream().use { out -> r.body.byteStream().copyTo(out) }
                tmp.renameTo(f)
            }
            prune()
        }
        f
    }

    private fun prune() {
        val files = dir().listFiles()?.filter { !it.name.endsWith(".part") }?.sortedByDescending { it.lastModified() } ?: return
        files.drop(KEEP).forEach { it.delete() }
    }

    /** Sign-out: nothing of the old account's stays. */
    fun clear() {
        dir().listFiles()?.forEach { it.delete() }
    }
}
