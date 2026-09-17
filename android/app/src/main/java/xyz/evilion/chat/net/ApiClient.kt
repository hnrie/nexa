package xyz.evilion.chat.net

import xyz.evilion.chat.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody
import okio.BufferedSink
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** An error the server reported, or a transport failure dressed up as one. */
class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val retryAfter: Double? = null,
) : Exception(message) {
    val isAuth: Boolean get() = status == 401
    /** Worth trying again: a dropped connection, a restart, a rate limit. */
    val isTransient: Boolean get() = status == 0 || status == 408 || status == 429 || status >= 500
}

/**
 * The HTTP client. Everything goes through [request], which knows the three
 * things the rest of the app should not have to: where the API lives, how the
 * bearer token is attached, and what the server's error envelope looks like.
 */
object Api {
    private const val API_PREFIX = "/api/v1"

    /**
     * Where the API lives. The build says which instance this app ships
     * pointing at; whoever signs in can send it somewhere else, and that
     * choice is what SecureStore puts back on the next launch.
     */
    @Volatile
    var baseUrl: String = BuildConfig.DEFAULT_SERVER

    @Volatile
    var token: String? = null

    /** Called for every 401 that came back from an authenticated request. */
    @Volatile
    var onUnauthorized: (() -> Unit)? = null

    @OptIn(ExperimentalSerializationApi::class)
    val json: Json = Json {
        ignoreUnknownKeys = true
        // Defaults travel too: the server checks fields like the KDF version,
        // which would otherwise be dropped for looking like "nothing set".
        encodeDefaults = true
        explicitNulls = false
        isLenient = true
        coerceInputValues = true
        namingStrategy = JsonNamingStrategy.SnakeCase
    }

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(0, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /** The same client, with the patience a multi-gigabyte upload needs. */
    val uploadHttp: OkHttpClient = http.newBuilder()
        .writeTimeout(10, TimeUnit.MINUTES)
        .readTimeout(5, TimeUnit.MINUTES)
        .build()

    private val JSON_TYPE = "application/json".toMediaType()
    private val OCTET = "application/octet-stream".toMediaType()

    /** Paths the server serves outside the versioned API. */
    private val VERBATIM = listOf("/media/", "/api/", "/native/", "/android/", "/desktop/", "/twemoji/", "/.well-known/")

    /** Absolute URL for a path; site paths are used verbatim, the rest is versioned. */
    fun url(path: String, query: Map<String, String?> = emptyMap()): HttpUrl {
        val base = baseUrl.trimEnd('/') + if (VERBATIM.any { path.startsWith(it) }) path else API_PREFIX + path
        val builder = base.toHttpUrl().newBuilder()
        for ((k, v) in query) if (v != null) builder.setQueryParameter(k, v)
        return builder.build()
    }

    fun gatewayUrl(): String =
        baseUrl.trimEnd('/').replaceFirst("http", "ws") + "/gateway"

    /** The raw body of a request, or an [ApiException]. */
    suspend fun requestRaw(
        method: String,
        path: String,
        body: String? = null,
        query: Map<String, String?> = emptyMap(),
        headers: Map<String, String> = emptyMap(),
    ): String {
        val request = Request.Builder()
            .url(url(path, query))
            .apply {
                val payload = body?.toRequestBody(JSON_TYPE)
                method(method, payload ?: emptyBodyFor(method))
                header("Accept", "application/json")
                token?.let { header("Authorization", "Bearer $it") }
                for ((k, v) in headers) header(k, v)
            }
            .build()
        return http.await(request).use { res -> readOrThrow(res) }
    }

    /** A request whose answer is parsed; pass [Unit] for one that has none. */
    suspend inline fun <reified T> request(
        method: String,
        path: String,
        body: String? = null,
        query: Map<String, String?> = emptyMap(),
        headers: Map<String, String> = emptyMap(),
    ): T {
        val text = requestRaw(method, path, body, query, headers)
        if (T::class == Unit::class) return Unit as T
        return json.decodeFromString(text)
    }

    /** JSON for a request body. */
    inline fun <reified B> body(value: B): String = json.encodeToString(value)

    /** Sends bytes, reporting how many have gone out. Used by uploads. */
    suspend fun upload(
        method: String,
        path: String,
        bytes: ByteArray,
        headers: Map<String, String> = emptyMap(),
        query: Map<String, String?> = emptyMap(),
        onProgress: ((Long, Long) -> Unit)? = null,
    ): String {
        val body = object : RequestBody() {
            override fun contentType() = OCTET
            override fun contentLength() = bytes.size.toLong()
            override fun writeTo(sink: BufferedSink) {
                var at = 0
                val step = 64 * 1024
                while (at < bytes.size) {
                    val n = minOf(step, bytes.size - at)
                    sink.write(bytes, at, n)
                    at += n
                    onProgress?.invoke(at.toLong(), bytes.size.toLong())
                }
            }
        }
        val request = Request.Builder()
            .url(url(path, query))
            .method(method, body)
            .header("Accept", "application/json")
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .apply { for ((k, v) in headers) header(k, v) }
            .build()
        return uploadHttp.await(request).use { res -> readOrThrow(res) }
    }

    /** An open response body: the bytes, how many there are, and the handle to close. */
    class Stream(val input: InputStream, val length: Long, private val response: Response) : AutoCloseable {
        override fun close() = response.close()
    }

    /** Opens a stream of a media path, for attachments and avatars. */
    suspend fun openStream(path: String, authorized: Boolean = true): Stream {
        val request = Request.Builder()
            .url(url(path))
            .get()
            .apply { if (authorized) token?.let { header("Authorization", "Bearer $it") } }
            .build()
        val res = http.await(request)
        if (!res.isSuccessful) {
            val err = errorFrom(res.code, res.body.string(), res.header("Retry-After"))
            res.close()
            throw err
        }
        val body: ResponseBody = res.body
        return Stream(body.byteStream(), body.contentLength(), res)
    }

    private fun emptyBodyFor(method: String): RequestBody? =
        if (method == "POST" || method == "PUT" || method == "PATCH") ByteArray(0).toRequestBody(null) else null

    private fun readOrThrow(res: Response): String {
        val text = if (res.code == 204 || res.code == 205) "" else res.body.string()
        if (!res.isSuccessful) {
            if (res.code == 401 && token != null) onUnauthorized?.invoke()
            throw errorFrom(res.code, text, res.header("Retry-After"))
        }
        return text
    }

    /** The server's envelope is `{ "error": { "code": ..., "message": ... } }`. */
    fun errorFrom(status: Int, body: String, retryAfterHeader: String?): ApiException {
        val retryAfter = retryAfterHeader?.trim()?.toDoubleOrNull()?.takeIf { it >= 0 }
        val parsed = runCatching {
            val obj = json.parseToJsonElement(body) as? kotlinx.serialization.json.JsonObject
            val err = obj?.get("error") as? kotlinx.serialization.json.JsonObject
            val code = (err?.get("code") as? kotlinx.serialization.json.JsonPrimitive)?.content
            val message = (err?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content
            if (code != null && message != null) ApiException(status, code, message, retryAfter) else null
        }.getOrNull()
        return parsed ?: ApiException(status, "http_$status", "Request failed with status $status.", retryAfter)
    }
}

/** OkHttp's callback API as a suspending call that cancels with the coroutine. */
suspend fun OkHttpClient.await(request: Request): Response = withContext(Dispatchers.IO) {
    suspendCancellableCoroutine { cont ->
        val call = newCall(request)
        cont.invokeOnCancellation { runCatching { call.cancel() } }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!cont.isCancelled) {
                    cont.resumeWithException(ApiException(0, "network", e.message ?: "The server could not be reached."))
                }
            }

            override fun onResponse(call: Call, response: Response) {
                cont.resume(response)
            }
        })
    }
}
