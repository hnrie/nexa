package xyz.evilion.chat.data

import xyz.evilion.chat.crypto.Bytes
import java.util.Base64

/**
 * Invite links may carry the server's current root key in the fragment
 * (`#k=<epoch>.<base64url root>`). Fragments never reach the server, so the key
 * stays end to end: the inviter hands it to whoever they gave the link to, and
 * the history opens the moment they arrive rather than when someone online
 * gets round to granting it.
 */
data class InviteKey(val epoch: Int, val root: ByteArray) {
    override fun equals(other: Any?): Boolean = other is InviteKey && epoch == other.epoch && root.contentEquals(other.root)
    override fun hashCode(): Int = epoch * 31 + root.contentHashCode()
}

object InviteLink {
    private val FRAGMENT = Regex("(?:^|[#&])k=(\\d+)\\.([A-Za-z0-9_-]{40,50})(?:&|$)")

    /** The code and key in anything a person might paste: a whole link, or just the code. */
    fun parse(text: String): Pair<String, InviteKey?> {
        val trimmed = text.trim()
        val hash = trimmed.substringAfter('#', "")
        val code = trimmed.substringBefore('#').trimEnd('/').substringAfterLast('/')
        return code to parseFragment(hash)
    }

    fun parseFragment(hash: String): InviteKey? {
        val m = FRAGMENT.find(hash) ?: return null
        val root = runCatching { Base64.getUrlDecoder().decode(m.groupValues[2].padTo4()) }.getOrNull() ?: return null
        if (root.size != 32) return null
        return InviteKey(m.groupValues[1].toIntOrNull() ?: return null, root)
    }

    fun encodeFragment(key: InviteKey): String =
        "k=${key.epoch}.${Base64.getUrlEncoder().withoutPadding().encodeToString(key.root)}"

    /** The link for a code, with the key when this device holds one to share. */
    fun url(base: String, code: String, key: InviteKey?): String {
        val link = "${base.trimEnd('/')}/invite/$code"
        return if (key == null) link else "$link#${encodeFragment(key)}"
    }

    private fun String.padTo4(): String = this + "=".repeat((4 - length % 4) % 4)
}
