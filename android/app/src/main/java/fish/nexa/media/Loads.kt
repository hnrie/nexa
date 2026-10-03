package fish.nexa.media

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalWindowInfo
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.DecryptError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import java.io.File

/** What a file being shown needs next, smaller first (mediaCache.ts PRIORITY). */
object Priority {
    const val OPEN = -1
    const val VISIBLE = 0
    const val NEAR = 1
}

/** The biggest file shown inline (INLINE_MAX); anything larger is a file card. */
const val INLINE_MAX = 256L * 1024 * 1024

/** Files up to this load by themselves as they come near the screen; bigger ones wait for a tap (AUTO_LOAD_MAX). */
const val AUTO_LOAD_MAX = 25L * 1024 * 1024

/**
 * loadQueue.ts: downloads take turns, the ones on screen first, a few at a
 * time (fewer on a small phone or a slow connection), so the tiles in view
 * finish first rather than everything arriving late together.
 */
object LoadQueue {
    private class Job(val key: String, var priority: Int, val seq: Long, val run: suspend () -> File, val done: CompletableDeferred<File>)

    private val waiting = ArrayList<Job>()
    private val running = HashMap<String, Job>()
    private var seq = 0L

    private fun slots(): Int {
        val ctx = Nexa.app
        val cores = Runtime.getRuntime().availableProcessors()
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val gb = info.totalMem / (1024.0 * 1024 * 1024)
        var n = if (cores >= 8 && gb >= 4) 6 else if (cores >= 4 && gb >= 2) 4 else 2
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (cm.isActiveNetworkMetered && cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED) n = minOf(n, 2)
        return n
    }

    /** Loads a file once however many ask; a later, more urgent ask moves it up. */
    suspend fun load(key: String, priority: Int, run: suspend () -> File): File {
        val job = synchronized(this) {
            running[key] ?: waiting.firstOrNull { it.key == key }?.also { if (priority < it.priority) it.priority = priority }
            ?: Job(key, priority, seq++, run, CompletableDeferred()).also { waiting += it }
        }
        pump()
        return job.done.await()
    }

    fun prioritize(key: String, priority: Int) {
        synchronized(this) { waiting.firstOrNull { it.key == key }?.let { if (priority < it.priority) it.priority = priority } }
    }

    private fun pump() {
        while (true) {
            val job = synchronized(this) {
                if (running.size >= slots() || waiting.isEmpty()) return
                val next = waiting.minWith(compareBy<Job>({ it.priority }, { it.seq }))
                waiting.remove(next)
                running[next.key] = next
                next
            }
            Nexa.scope.launch {
                try {
                    job.done.complete(job.run())
                } catch (e: CancellationException) {
                    job.done.completeExceptionally(e)
                } catch (e: Throwable) {
                    job.done.completeExceptionally(e)
                } finally {
                    synchronized(this@LoadQueue) { running.remove(job.key) }
                    pump()
                }
            }
        }
    }
}

/** Fetches and opens an attachment through the queue: the decrypted file, or a webhook's plain one. */
suspend fun loadAttachment(att: AttachmentMeta, priority: Int, onProgress: ((Long, Long) -> Unit)? = null): File {
    if (att.size > INLINE_MAX) throw IllegalStateException("too large to show")
    return LoadQueue.load(att.blobId, priority) {
        if (att.plain) Media.plain(att.blobId) else Media.decrypted(att.blobId, att.key, att.size, onProgress)
    }
}

/** A file already opened on this device, without waiting. */
fun cachedAttachment(att: AttachmentMeta): File? = Media.cached(att.blobId, att.plain)

@Stable
class AttachmentLoad(initial: File?) {
    var file by mutableStateOf(initial)
    /** "load" when it could not be fetched (worth a retry), "decrypt" when it could not be opened. */
    var error by mutableStateOf<String?>(null)
    var wanted by mutableStateOf(false)
    var attempt by mutableStateOf(0)
    var onScreen = false

    fun load() {
        wanted = true
    }

    fun retry() {
        error = null
        attempt += 1
    }
}

/**
 * useDecrypted: the file for an attachment shown in the list. It loads by
 * itself when [auto] (small enough, or a picture's small copy) once the row
 * is composed, which a lazy list does only near the screen; otherwise it waits
 * for [AttachmentLoad.load]. What is on screen goes ahead of what is near it.
 */
@Composable
fun rememberAttachmentLoad(att: AttachmentMeta, auto: Boolean): AttachmentLoad {
    val state = remember(att.blobId) { AttachmentLoad(cachedAttachment(att)) }
    LaunchedEffect(att.blobId, auto) { if (auto) state.wanted = true }
    LaunchedEffect(att.blobId, state.wanted, state.attempt) {
        if (!state.wanted || state.file != null || state.error != null) return@LaunchedEffect
        try {
            state.file = loadAttachment(att, if (state.onScreen) Priority.VISIBLE else Priority.NEAR)
        } catch (e: CancellationException) {
            throw e
        } catch (e: DecryptError) {
            state.error = "decrypt"
        } catch (e: Exception) {
            state.error = "load"
        }
    }
    return state
}

/** Tells a load whether its frame is on screen, so it can go first. */
@Composable
fun Modifier.loadPriority(state: AttachmentLoad, blobId: String): Modifier {
    val window = LocalWindowInfo.current.containerSize
    return this.onGloballyPositioned { coords ->
        val b: Rect = coords.boundsInWindow()
        val visible = b.bottom > 0 && b.top < window.height && b.width > 0
        if (visible && !state.onScreen) LoadQueue.prioritize(blobId, Priority.VISIBLE)
        state.onScreen = visible
    }
}
