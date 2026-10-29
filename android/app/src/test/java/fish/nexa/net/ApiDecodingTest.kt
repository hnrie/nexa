package fish.nexa.net

import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encoding.Decoder
import org.junit.Assert.*
import org.junit.Test

class ApiDecodingTest {
    private fun respond(body: String, check: (Api) -> Unit) {
        ServerSocket(0).use { server ->
            server.soTimeout = 10_000
            val worker = thread(isDaemon = true) {
                server.accept().use { socket ->
                    socket.soTimeout = 10_000
                    val input = socket.getInputStream().bufferedReader()
                    while (!input.readLine().isNullOrEmpty()) { }
                    val bytes = body.toByteArray()
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(bytes)
                        flush()
                    }
                }
            }
            try { check(Api("http://127.0.0.1:${server.localPort}")) } finally { worker.join(10_000) }
        }
    }

    @Test fun typedResponseDecodesAwayFromTheCallingUiThread() = respond("[1,2,3]") { api ->
        val caller = Thread.currentThread()
        var decoding: Thread? = null
        val delegate = ListSerializer(Int.serializer())
        val strategy = object : DeserializationStrategy<List<Int>> by delegate {
            override fun deserialize(decoder: Decoder): List<Int> {
                decoding = Thread.currentThread()
                return delegate.deserialize(decoder)
            }
        }
        val result = runBlocking { api.get("/test", strategy) }
        assertEquals(listOf(1, 2, 3), result)
        assertNotNull(decoding)
        assertNotSame(caller, decoding)
    }

    @Test fun invalidTypedResponseKeepsTheExistingErrorContract() = respond("{}") { api ->
        val error = runCatching { runBlocking { api.get("/test", ListSerializer(Int.serializer())) } }.exceptionOrNull()
        assertTrue(error is ApiError)
        assertEquals("bad_response", (error as ApiError).code)
        assertEquals(200, error.status)
    }
}
