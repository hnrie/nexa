package fish.nexa.crypto

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Safety numbers (web/src/crypto/fingerprint.ts): thirty digits in six groups,
 * the same on every client for the same key, or comparing them means nothing.
 *
 *   h = SHA-256("evilion-chat/fingerprint/v1" ‖ key)
 *   h = SHA-256(h ‖ key), until 5200 hashes have been taken
 *   digits = for g in 0..5: uint40be(h[5g .. 5g+5]) mod 100000, zero-padded
 */
object Fingerprint {
    private val PREFIX = Bytes.utf8("evilion-chat/fingerprint/v1")
    private val cache = object : LinkedHashMap<String, String>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 256
    }

    fun of(publicKey: ByteArray): String {
        require(publicKey.size == 32) { "fingerprint: not an identity public key" }
        var h = Bytes.sha256(PREFIX, publicKey)
        for (i in 1 until 5200) h = Bytes.sha256(h, publicKey)
        return (0 until 6).joinToString(" ") { g ->
            var n = 0L
            for (k in 0 until 5) n = (n shl 8) or (h[g * 5 + k].toLong() and 0xff)
            (n % 100000).toString().padStart(5, '0')
        }
    }

    /** For a key as the API carries it (base64); null for a missing or malformed key. */
    @Synchronized fun ofB64(b64: String?): String? {
        if (b64.isNullOrEmpty()) return null
        cache[b64]?.let { return it }
        val out = try {
            of(Bytes.unb64(b64))
        } catch (_: Exception) {
            return null
        }
        cache[b64] = out
        return out
    }
}

/** Synced settings: base64(iv ‖ AES-GCM(JSON)) under the identity-bound settings key, AAD "settings/v1". */
object SettingsCrypto {
    private val AAD = Bytes.utf8("settings/v1")

    fun encrypt(key: ByteArray, doc: JsonElement): String {
        val iv = Bytes.random(12)
        return Bytes.b64(Bytes.concat(iv, Bytes.gcmEncrypt(key, iv, Bytes.utf8(doc.toString()), AAD)))
    }

    fun decrypt(key: ByteArray, blob: String): JsonElement? = try {
        val raw = Bytes.unb64(blob)
        if (raw.size < 13) null else {
            val pt = Bytes.gcmDecrypt(key, raw.copyOfRange(0, 12), raw, AAD, 12, raw.size - 12)
            MessageCrypto.json.parseToJsonElement(Bytes.str(pt))
        }
    } catch (_: Exception) {
        null
    }
}

/**
 * How a note is sealed (web/src/crypto/notes.ts): its own 32-byte key seals
 * its head, body, updates and cursors as "v1.<iv>.<ct>" in base64url, each
 * bound to what part it is; the key reaches each person as a sealed box, and
 * a share link carries a second key in its fragment.
 */
object NoteCrypto {
    enum class Part(val wire: String) { HEAD("head"), BODY("body"), LINK("link"), LINK_KEY("link-key"), PREV_KEY("prev-key"), CURSOR("cursor"), UPDATE("update") }

    private fun aad(part: Part) = Bytes.utf8("nexa-note/v1/${part.wire}")

    fun newNoteKey(): ByteArray = Bytes.random(32)

    private fun sealBytes(key: ByteArray, part: Part, data: ByteArray): String {
        require(key.size == 32) { "a note key is 32 bytes" }
        val iv = Bytes.random(Bytes.IV_LEN)
        return "v1.${Bytes.b64url(iv)}.${Bytes.b64url(Bytes.gcmEncrypt(key, iv, data, aad(part)))}"
    }

    private fun openBytes(key: ByteArray, part: Part, sealed: String): ByteArray {
        val pieces = sealed.split(".")
        if (pieces.size != 3 || pieces[0] != "v1") throw DecryptError("not a sealed note")
        try {
            val iv = Bytes.unb64url(pieces[1])
            val ct = Bytes.unb64url(pieces[2])
            if (iv.size != Bytes.IV_LEN || ct.size < Bytes.TAG_LEN) throw DecryptError("short")
            return Bytes.gcmDecrypt(key, iv, ct, aad(part))
        } catch (_: Exception) {
            throw DecryptError("the note could not be opened")
        }
    }

    fun seal(key: ByteArray, part: Part, value: JsonElement): String = sealBytes(key, part, Bytes.utf8(value.toString()))

    fun open(key: ByteArray, part: Part, sealed: String): JsonElement {
        val bytes = openBytes(key, part, sealed)
        return try {
            MessageCrypto.json.parseToJsonElement(Bytes.str(bytes))
        } catch (_: Exception) {
            throw DecryptError("the note could not be read")
        }
    }

    fun sealUpdate(key: ByteArray, update: ByteArray): String = sealBytes(key, Part.UPDATE, update)
    fun openUpdate(key: ByteArray, sealed: String): ByteArray = openBytes(key, Part.UPDATE, sealed)

    fun sealKey(recipientPub: ByteArray, key: ByteArray): String = Bytes.b64url(Keys.seal(recipientPub, key))

    fun openKey(identity: Identity, sealed: String): ByteArray {
        val box = try {
            Bytes.unb64url(sealed)
        } catch (_: Exception) {
            throw DecryptError("the note's key is not readable")
        }
        val key = Keys.open(identity.privateKey, identity.publicKey, box)
        if (key.size != 32) throw DecryptError("the note's key is the wrong size")
        return key
    }

    fun wrapPreviousKey(newKey: ByteArray, oldKey: ByteArray): String = sealBytes(newKey, Part.PREV_KEY, oldKey)

    fun unwrapPreviousKey(newerKey: ByteArray, wrapped: String): ByteArray {
        val key = openBytes(newerKey, Part.PREV_KEY, wrapped)
        if (key.size != 32) throw DecryptError("the earlier key is the wrong size")
        return key
    }

    /** The key a note had at `epoch`, walking back from its key now through the wrapped earlier ones. */
    fun keyAt(key: ByteArray, current: Int, epoch: Int, wrapped: Map<Int, String>): ByteArray {
        if (epoch > current || epoch < 0) throw DecryptError("no such key")
        var k = key
        for (e in current - 1 downTo epoch) {
            val w = wrapped[e] ?: throw DecryptError("an earlier key is missing")
            k = unwrapPreviousKey(k, w)
        }
        return k
    }

    data class LinkSecret(val token: String, val key: String)

    fun newLink() = LinkSecret(Bytes.b64url(Bytes.random(18)), Bytes.b64url(Bytes.random(32)))

    fun tokenHash(token: String): String = Bytes.hex(Bytes.sha256(Bytes.utf8("nexa-note-link\u0000$token")))

    private fun linkKey(secret: LinkSecret): ByteArray {
        val key = try {
            Bytes.unb64url(secret.key)
        } catch (_: Exception) {
            throw DecryptError("the link's key is not readable")
        }
        if (key.size != 32) throw DecryptError("the link's key is the wrong size")
        return key
    }

    fun wrapKeyForLink(secret: LinkSecret, noteKey: ByteArray): String =
        sealBytes(linkKey(secret), Part.LINK_KEY, Bytes.concat(Bytes.utf8(secret.token + "\u0000"), noteKey))

    fun unwrapKeyFromLink(secret: LinkSecret, wrapped: String): ByteArray {
        val bytes = openBytes(linkKey(secret), Part.LINK_KEY, wrapped)
        val prefix = Bytes.utf8(secret.token + "\u0000")
        if (bytes.size != prefix.size + 32 || !bytes.copyOfRange(0, prefix.size).contentEquals(prefix)) throw DecryptError("the link does not belong to this note")
        return bytes.copyOfRange(prefix.size, bytes.size)
    }

    private val TOKEN_RE = Regex("^[A-Za-z0-9_-]{16,128}$")
    private val KEY_RE = Regex("^[A-Za-z0-9_-]{43}$")

    fun sealLink(noteKey: ByteArray, secret: LinkSecret): String =
        sealBytes(noteKey, Part.LINK, Bytes.utf8(JsonObject(mapOf("token" to JsonPrimitive(secret.token), "key" to JsonPrimitive(secret.key))).toString()))

    fun openLink(noteKey: ByteArray, sealed: String): LinkSecret {
        val bytes = openBytes(noteKey, Part.LINK, sealed)
        try {
            val o = MessageCrypto.json.parseToJsonElement(Bytes.str(bytes)) as JsonObject
            val token = o.str("token")
            val key = o.str("key")
            if (token != null && key != null && TOKEN_RE.matches(token) && KEY_RE.matches(key)) return LinkSecret(token, key)
        } catch (_: Exception) {
        }
        throw DecryptError("the link could not be read")
    }

    fun linkPath(secret: LinkSecret) = "/note/${secret.token}#${secret.key}"

    private val PATH_RE = Regex("^/note/([A-Za-z0-9_-]{16,128})/?$")

    /** Reads a share link (a whole address or its path) back into its two secrets. */
    fun parseLink(link: String, origin: String? = null): LinkSecret? {
        val uri = try {
            java.net.URI(if (link.startsWith("/")) "https://nexa.invalid$link" else link)
        } catch (_: Exception) {
            return null
        }
        if (origin != null && !link.startsWith("/")) {
            val o = try { java.net.URI(origin) } catch (_: Exception) { return null }
            if (!uri.scheme.equals(o.scheme, true) || !uri.host.equals(o.host, true) || uri.port != o.port) return null
        }
        val m = PATH_RE.find(uri.rawPath ?: return null) ?: return null
        val key = uri.rawFragment ?: return null
        if (!KEY_RE.matches(key)) return null
        return LinkSecret(m.groupValues[1], key)
    }
}
