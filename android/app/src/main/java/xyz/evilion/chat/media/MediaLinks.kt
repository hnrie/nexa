package xyz.evilion.chat.media

import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import coil3.request.ImageResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.MediaApi
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Every picture this app loads by address, kept to this server.
 *
 * Link previews and GIFs are signed links to the server's media proxy, so the
 * site a picture comes from never learns who is looking at it. They come as
 * paths ("/media/proxy/…"), which the image loader took for files on the phone:
 * no link preview picture ever showed. Their signatures also run out after a
 * day (internal/api/proxy_handlers.go), and a preview lives inside its
 * message's end-to-end encryption where the server cannot renew it — so a stale
 * one is signed again, a batch at a time, before it is fetched.
 *
 * Any other site's address is not fetched at all. The sender writes a preview,
 * the server never sees it, and a picture from anywhere else would hand that
 * site the reader's address.
 */
object MediaLinks {
    private const val PROXY = "/media/proxy/"

    /** A link this close to its deadline is signed again rather than risked. */
    private const val MARGIN_MS = 5 * 60 * 1000L
    private const val BATCH = 100
    private const val GATHER_MS = 30L

    /** An address on another site, which is never fetched. */
    class Refused(url: String) : IllegalArgumentException("not loaded from another site: ${url.take(64)}")

    /** The server could not be asked to sign a link again just now; it is asked next time. */
    class Unreachable(cause: Throwable) : IOException("could not renew a media link", cause)

    private val renewed = ConcurrentHashMap<String, String>()
    private val refused: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val waiting = mutableMapOf<String, CompletableDeferred<String?>>()
    private val lock = Any()
    private var flushJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The path of a link to this server, or null for another site's (or no) address. */
    fun serverPath(url: String, base: String = Api.baseUrl): String? {
        if (url.startsWith("/") && !url.startsWith("//")) return url
        val target = url.toHttpUrlOrNull() ?: return null
        val home = base.toHttpUrlOrNull() ?: return null
        if (!target.host.equals(home.host, ignoreCase = true) || target.port != home.port) return null
        return target.encodedPath + (target.encodedQuery?.let { "?$it" } ?: "")
    }

    fun isProxy(path: String): Boolean = path.startsWith(PROXY)

    /** When a proxy link stops working, in milliseconds; null for one signed before links had deadlines. */
    fun deadline(path: String): Long? {
        if (!isProxy(path)) return null
        val sig = path.removePrefix(PROXY).substringBefore('/')
        val seconds = Regex("^(\\d{9,12})-").find(sig)?.groupValues?.get(1)?.toLongOrNull() ?: return null
        return seconds * 1000
    }

    /**
     * What a media link points at, the same however often it is signed. Every
     * signing has a new deadline, so a new address: comparing addresses said a
     * favourite GIF was not one.
     */
    fun key(url: String): String {
        val path = serverPath(url) ?: return url
        if (!isProxy(path)) return url
        return path.removePrefix(PROXY).substringAfter('/', url)
    }

    private fun fresh(path: String, now: Long): Boolean = deadline(path)?.let { it - now > MARGIN_MS } == true

    private fun absolute(path: String): String = Api.baseUrl.trimEnd('/') + path

    /**
     * The address to fetch for [url], signed again if it has to be; null for an
     * address on another site, which must not be fetched from here.
     */
    suspend fun resolve(url: String, now: Long = System.currentTimeMillis()): String? {
        // the phone's own files and data are not addresses
        if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("/")) return url
        val path = serverPath(url) ?: return null
        if (!isProxy(path) || fresh(path, now)) return absolute(path)
        renewed[path]?.let { if (fresh(it, now)) return absolute(it) }
        if (path in refused) return null
        val signed = ask(path) ?: return null
        return absolute(signed)
    }

    private suspend fun ask(path: String): String? {
        val waiter = synchronized(lock) {
            val w = waiting.getOrPut(path) { CompletableDeferred() }
            if (flushJob?.isActive != true) {
                flushJob = scope.launch {
                    delay(GATHER_MS)
                    flush()
                }
            }
            w
        }
        return waiter.await()
    }

    private suspend fun flush() {
        while (true) {
            val batch = synchronized(lock) {
                val taken = waiting.entries.take(BATCH).associate { it.key to it.value }
                for (k in taken.keys) waiting.remove(k)
                taken
            }
            if (batch.isEmpty()) return
            try {
                val urls = MediaApi.refresh(batch.keys.toList())
                for ((path, waiter) in batch) {
                    val signed = urls[path]?.let { serverPath(it) }?.takeIf { isProxy(it) }
                    if (signed != null) {
                        renewed[path] = signed
                        waiter.complete(signed)
                    } else {
                        refused += path
                        waiter.complete(null)
                    }
                }
            } catch (e: Throwable) {
                // Offline, or turned away for asking too often: this load fails
                // as a network failure, and the next one asks again. Taking it as
                // a refusal would call every favourite GIF gone.
                for (waiter in batch.values) waiter.completeExceptionally(Unreachable(e))
            }
        }
    }

    /** For tests. */
    internal fun forget() {
        renewed.clear()
        refused.clear()
    }

    /** Puts every string address the image loader is given through [resolve]. */
    class LoaderInterceptor : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val data = chain.request.data as? String ?: return chain.proceed()
            val resolved = try {
                resolve(data)
            } catch (e: Unreachable) {
                return ErrorResult(null, chain.request, e)
            } ?: return ErrorResult(null, chain.request, Refused(data))
            if (resolved == data) return chain.proceed()
            return chain.withRequest(chain.request.newBuilder().data(resolved).build()).proceed()
        }
    }
}
