package xyz.evilion.chat.data

import android.content.Context
import android.util.Log
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import xyz.evilion.chat.BuildConfig
import xyz.evilion.chat.net.Api
import java.io.File

/**
 * Crashes that take the app down.
 *
 * A crash in a phone app is otherwise invisible: the app disappears, the
 * person shrugs, and nobody who could fix it ever hears about it. This writes
 * what happened to a file before the process goes, and sends it the next time
 * the app starts with someone signed in. Writing first and sending later
 * matters: a process on its way out has no time for a request.
 */
object CrashReport {
    private const val TAG = "CrashReport"
    private const val FILE = "last-crash.txt"
    private var dir: File? = null

    fun install(context: Context) {
        dir = context.filesDir
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { write(thread, error) }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun write(thread: Thread, error: Throwable) {
        val file = File(dir ?: return, FILE)
        val stack = StringBuilder()
        var cause: Throwable? = error
        var depth = 0
        while (cause != null && depth < 5) {
            if (depth > 0) stack.append("caused by: ")
            stack.append(cause.toString()).append('\n')
            for (line in cause.stackTrace.take(40)) stack.append("  at ").append(line).append('\n')
            cause = cause.cause
            depth++
        }
        file.writeText("${error::class.java.name}: ${error.message}\non ${thread.name}\n\n$stack")
    }

    /** Sends whatever the last crash left behind, once, and forgets it. */
    suspend fun sendPending() {
        val file = File(dir ?: return, FILE)
        if (!file.exists()) return
        val text = runCatching { file.readText() }.getOrNull()
        runCatching { file.delete() }
        if (text.isNullOrBlank() || Api.token == null) return
        val firstLine = text.lineSequence().firstOrNull().orEmpty()
        val body = buildJsonObject {
            put("kind", "error")
            put("message", firstLine.take(500))
            put("stack", text.take(8000))
            put("component", "android")
            put("path", "app")
            put("version", BuildConfig.VERSION_NAME)
        }.toString()
        val request = Request.Builder()
            .url(Api.url("/client-errors"))
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer ${Api.token}")
            .build()
        runCatching { Api.http.newCall(request).execute().close() }
            .onFailure { Log.w(TAG, "could not send the last crash", it) }
    }
}
