package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Identity
import fish.nexa.crypto.Keys
import fish.nexa.net.MeUser
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URLEncoder

/**
 * Signing in with a QR code (web/src/lib/qrLogin.ts, internal/api/qr_login.go).
 * A code is a link to `/login/qr#<id>.<public key>`; the phone that scans it
 * seals the identity key to the public key in the code, never to one the
 * server names, and the waiting device opens the box with its one-time key.
 */
object QrLogin {
    class Code(val id: String, val publicKey: ByteArray)

    private val LINK = Regex("^([A-Za-z0-9_-]{16,64})\\.([A-Za-z0-9_-]{43})$")

    fun link(origin: String, id: String, publicKey: ByteArray) = "$origin/login/qr#$id.${Bytes.b64url(publicKey)}"

    /** Reads a code's link (or just what comes after its #); null when it is not one. */
    fun parse(text: String): Code? {
        val frag = if ('#' in text) text.substringAfter('#') else text
        val m = LINK.matchEntire(frag.trim()) ?: return null
        val key = try { Bytes.unb64url(m.groupValues[2]) } catch (_: Exception) { return null }
        return if (key.size == 32) Code(m.groupValues[1], key) else null
    }

    /** The phone's side: says it scanned the code, and learns which device is asking (its user agent). */
    suspend fun scan(id: String): String {
        val r = Nexa.api.request("POST", "/auth/qr/$id/scan", JsonObject(emptyMap())) as JsonObject
        return r["user_agent"]?.jsonPrimitive?.contentOrNull ?: ""
    }

    suspend fun approve(code: Code, identity: Identity) {
        val box = Keys.seal(code.publicKey, identity.privateKey)
        Nexa.api.request("POST", "/auth/qr/${code.id}/approve", buildJsonObject { put("sealed_identity", Bytes.b64(box)) })
    }

    suspend fun deny(id: String) {
        Nexa.api.request("POST", "/auth/qr/$id/deny", JsonObject(emptyMap()))
    }

    sealed interface Wait {
        data class Showing(val link: String) : Wait
        data class Scanned(val user: PublicUser) : Wait
    }

    /**
     * The waiting side, for a wide screen's sign-in page: shows codes until one
     * is approved, then returns the session and the identity key it carried.
     */
    suspend fun waitForSignIn(onChange: (Wait) -> Unit): Triple<MeUser, String, Identity> {
        while (true) {
            val eph = Identity.generate()
            val req = Nexa.api.request("POST", "/auth/qr", buildJsonObject { put("public_key", Bytes.b64(eph.publicKey)) }, auth = false) as JsonObject
            val id = req["id"]!!.jsonPrimitive.content
            val poll = req["poll"]!!.jsonPrimitive.content
            onChange(Wait.Showing(link(fish.nexa.ui.markdown.AppLinks.shareOrigin(Nexa.api.baseUrl), id, eph.publicKey)))
            var seen = "pending"
            while (true) {
                val a = Nexa.api.request("GET", "/auth/qr/$id?poll=${URLEncoder.encode(poll, "UTF-8")}&seen=$seen", auth = false) as JsonObject
                val state = a["state"]?.jsonPrimitive?.contentOrNull ?: "expired"
                if (state == seen) continue
                if (state == "scanned") {
                    seen = state
                    a["user"]?.let { onChange(Wait.Scanned(wireJson.decodeFromJsonElement(PublicUser.serializer(), it))) }
                    continue
                }
                if (state == "approved") {
                    val me = wireJson.decodeFromJsonElement(MeUser.serializer(), a["user"]!!)
                    val pub = a["public_key"]!!.jsonPrimitive.content
                    val priv = Keys.open(eph.privateKey, eph.publicKey, Bytes.unb64(a["sealed_identity"]!!.jsonPrimitive.content))
                    // the box must hold the key of the account the session is for
                    if (Bytes.b64(Identity.publicKeyOf(priv)) != pub) throw IllegalStateException("qr: the key does not belong to the account")
                    return Triple(me, a["token"]!!.jsonPrimitive.content, Identity(Bytes.unb64(pub), priv))
                }
                break // denied or expired: a new code
            }
        }
    }
}
