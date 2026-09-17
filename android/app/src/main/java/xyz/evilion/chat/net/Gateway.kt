package xyz.evilion.chat.net

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.math.min
import kotlin.random.Random

enum class GatewayStatus { IDLE, CONNECTING, OPEN, CLOSED }

/** One event from the gateway: its name, and the payload it carries. */
data class GatewayEvent(val type: String, val data: JsonElement?)

/**
 * The realtime socket (internal/gateway/protocol.go).
 *
 * One connection carries everything: messages, presence, typing, key grants,
 * voice states and call signalling. It identifies with the session token, beats
 * every 25 seconds, and comes back on its own when a phone changes network.
 */
class Gateway(
    private val scope: CoroutineScope,
    private val token: () -> String?,
    private val url: () -> String = { Api.gatewayUrl() },
) {
    private companion object {
        const val TAG = "Gateway"
        const val HEARTBEAT_MS = 25_000L
        /**
         * How long a heartbeat may go unanswered. A phone that changes network
         * or wakes from sleep can keep a socket "open" for minutes after its
         * connection is gone, and nothing but silence ever says so.
         */
        const val ACK_TIMEOUT_MS = 8_000L
        const val MAX_BACKOFF_MS = 30_000L
        const val MAX_QUEUE = 64
    }

    private val _status = MutableStateFlow(GatewayStatus.IDLE)
    val status: StateFlow<GatewayStatus> = _status.asStateFlow()

    /**
     * Events reach the app in the order the socket delivered them.
     *
     * A coroutine per frame let the thread pool decide the order, which is no
     * order at all: a `message_create` could be handled before the `ready`
     * that replaces the channel it belongs to, an edit before the message it
     * edits, a reaction's removal before the reaction. One writer, from the
     * socket's own thread, into a queue one collector drains.
     */
    private val _events = MutableSharedFlow<GatewayEvent>(replay = 0, extraBufferCapacity = 1024)
    val events: SharedFlow<GatewayEvent> = _events.asSharedFlow()

    @Volatile
    private var socket: WebSocket? = null

    /**
     * The listener whose frames still count.
     *
     * `socket` is only assigned once `newWebSocket` returns, and OkHttp may
     * deliver the first frames before that, so comparing against it would
     * throw away the `ready` of the connection being opened. The listener
     * exists before the socket does, which makes it the thing to compare.
     */
    @Volatile
    private var live: Listener? = null
    private var beat: Job? = null
    private var reconnect: Job? = null
    private var attempt = 0
    private var closedByUser = false
    private var ready = false
    /** Written by the socket's reader thread, read by the heartbeat: it has to cross threads. */
    private val framesSeen = java.util.concurrent.atomic.AtomicLong(0)
    private val queue = ArrayDeque<String>()

    @Synchronized
    fun connect() {
        if (_status.value == GatewayStatus.CONNECTING || _status.value == GatewayStatus.OPEN) return
        closedByUser = false
        val auth = token()
        if (auth.isNullOrEmpty()) {
            _status.value = GatewayStatus.CLOSED
            return
        }
        _status.value = GatewayStatus.CONNECTING
        ready = false
        val request = Request.Builder().url(url()).build()
        val listener = Listener(auth)
        live = listener
        socket = Api.http.newWebSocket(request, listener)
    }

    @Synchronized
    fun disconnect() {
        closedByUser = true
        reconnect?.cancel()
        reconnect = null
        beat?.cancel()
        beat = null
        queue.clear()
        live = null
        socket?.close(1000, "bye")
        socket = null
        ready = false
        _status.value = GatewayStatus.CLOSED
    }

    /** Sends an op, holding it until the socket is ready if need be. */
    @Synchronized
    fun send(op: String, data: JsonObject = JsonObject(emptyMap())) {
        val frame = buildJsonObject {
            put("op", op)
            put("d", data)
        }.toString()
        val ws = socket
        if (ready && ws != null) {
            ws.send(frame)
            return
        }
        if (queue.size >= MAX_QUEUE) queue.removeFirst()
        queue.addLast(frame)
    }

    private inner class Listener(private val auth: String) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(buildJsonObject {
                put("op", "identify")
                put("d", buildJsonObject { put("token", auth) })
            }.toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            // a connection this object has already given up on may still
            // deliver what it had buffered; a `ready` from it would wipe out
            // everything the new one has done
            if (live !== this) return
            framesSeen.incrementAndGet()
            val frame = runCatching { Api.json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
            val type = frame["t"]?.jsonPrimitive?.content ?: return
            if (type == "ready") {
                synchronized(this@Gateway) {
                    attempt = 0
                    ready = true
                    _status.value = GatewayStatus.OPEN
                    while (queue.isNotEmpty()) webSocket.send(queue.removeFirst())
                    startHeartbeat(webSocket)
                }
            }
            // tryEmit keeps the order the socket gave us; the buffer is large
            // enough that only a collector that has stopped collecting fills it
            if (!_events.tryEmit(GatewayEvent(type, frame["d"]))) {
                Log.w(TAG, "dropped $type: the event queue is full")
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, code, reason)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            dropped(webSocket, response?.code ?: 0, t.message ?: "failed")

        private fun dropped(webSocket: WebSocket, code: Int, reason: String) {
            synchronized(this@Gateway) {
                if (live !== this) return
                live = null
                socket = null
                ready = false
                beat?.cancel()
                beat = null
                _status.value = GatewayStatus.CLOSED
                Log.i(TAG, "closed ($code) $reason")
                // 4001 means the token is no longer good; nothing to retry.
                if (closedByUser || code == 4001) return
                scheduleReconnect()
            }
        }
    }

    private fun startHeartbeat(ws: WebSocket) {
        beat?.cancel()
        beat = scope.launch {
            while (true) {
                delay(HEARTBEAT_MS)
                val before = framesSeen.get()
                ws.send("""{"op":"heartbeat"}""")
                delay(ACK_TIMEOUT_MS)
                // A healthy socket answers, or at least says something else.
                if (framesSeen.get() == before) {
                    Log.i(TAG, "heartbeat went unanswered; reconnecting")
                    synchronized(this@Gateway) {
                        if (socket === ws) {
                            live = null
                            socket = null
                            ready = false
                            _status.value = GatewayStatus.CLOSED
                            ws.cancel()
                            scheduleReconnect()
                        }
                    }
                    return@launch
                }
            }
        }
    }

    private fun scheduleReconnect() {
        if (reconnect?.isActive == true) return
        val wait = min(MAX_BACKOFF_MS, 500L * (1L shl min(attempt, 6))) + Random.nextLong(0, 400)
        attempt++
        reconnect = scope.launch {
            delay(wait)
            synchronized(this@Gateway) { reconnect = null }
            if (!closedByUser) connect()
        }
    }

    /** Called when the device's network comes back, to try again at once. */
    fun networkBack() {
        synchronized(this) {
            if (closedByUser || _status.value == GatewayStatus.OPEN) return
            attempt = 0
            reconnect?.cancel()
            reconnect = null
        }
        connect()
    }
}
