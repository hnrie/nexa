package fish.nexa.data

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.MessageCrypto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.OffsetDateTime
import java.util.Collections
import java.util.WeakHashMap

/**
 * Messages a webhook posted (web/src/lib/webhookMessage.ts). A webhook is a
 * secret address a program posts to, and what it sends reaches the server
 * readable, so these are the one kind of message that is not end-to-end
 * encrypted; their content arrives in the clear, shaped like Discord's
 * message, embed, component and poll objects. Everything is read defensively:
 * a wrong field must not crash the app while it draws.
 */
data class HookMedia(
    val url: String,
    val proxyUrl: String? = null,
    val blobId: String? = null,
    val attachmentId: String? = null,
    val width: Double? = null,
    val height: Double? = null,
    val contentType: String? = null,
    val description: String? = null,
)

data class HookEmbedAuthor(val name: String, val url: String? = null, val proxyIconUrl: String? = null, val iconBlobId: String? = null)
data class HookEmbedFooter(val text: String, val proxyIconUrl: String? = null, val iconBlobId: String? = null)
data class HookEmbedField(val name: String, val value: String, val inline: Boolean)

data class HookEmbed(
    val type: String,
    val title: String? = null,
    val description: String? = null,
    val url: String? = null,
    val timestamp: Long? = null,
    val color: Long? = null,
    val author: HookEmbedAuthor? = null,
    val footer: HookEmbedFooter? = null,
    val image: HookMedia? = null,
    val thumbnail: HookMedia? = null,
    val fields: List<HookEmbedField> = emptyList(),
)

data class HookEmoji(val id: String? = null, val name: String? = null, val animated: Boolean = false)

data class HookItem(val media: HookMedia, val description: String? = null, val spoiler: Boolean = false)

data class HookComponent(
    val type: Int,
    val components: List<HookComponent> = emptyList(),
    val accessory: HookComponent? = null,
    val style: Int? = null,
    val label: String? = null,
    val emoji: HookEmoji? = null,
    val url: String? = null,
    val disabled: Boolean = false,
    val content: String? = null,
    val media: HookMedia? = null,
    val file: HookMedia? = null,
    val description: String? = null,
    val spoiler: Boolean = false,
    val name: String? = null,
    val size: Double? = null,
    val items: List<HookItem> = emptyList(),
    val divider: Boolean? = null,
    val spacing: Int? = null,
    val accentColor: Long? = null,
)

data class HookPollAnswer(val answerId: Int, val text: String, val emoji: HookEmoji? = null)
data class HookPoll(val question: String, val answers: List<HookPollAnswer>, val expiry: Long, val allowMultiselect: Boolean)

data class HookAttachment(
    val id: String,
    val blobId: String,
    val filename: String,
    val size: Long,
    val title: String? = null,
    val description: String? = null,
    val contentType: String? = null,
    val width: Double? = null,
    val height: Double? = null,
    val spoiler: Boolean = false,
    val duration: Double? = null,
    val inline: Boolean = false,
)

data class HookContent(
    val name: String,
    val avatarId: String? = null,
    val avatarProxyUrl: String? = null,
    val avatarUrl: String? = null,
    val content: String = "",
    val tts: Boolean = false,
    val embeds: List<HookEmbed> = emptyList(),
    val components: List<HookComponent> = emptyList(),
    val poll: HookPoll? = null,
    val attachments: List<HookAttachment> = emptyList(),
    /** Link previews the server made for the webhook's links, held to MessageCrypto.sanitizeEmbed. */
    val linkEmbeds: List<JsonObject> = emptyList(),
    val source: String? = null,
)

object Hooks {
    const val C_ACTION_ROW = 1
    const val C_BUTTON = 2
    const val C_SECTION = 9
    const val C_TEXT = 10
    const val C_THUMBNAIL = 11
    const val C_GALLERY = 12
    const val C_FILE = 13
    const val C_SEPARATOR = 14
    const val C_CONTAINER = 17
    const val BUTTON_LINK = 5

    private val ID = Regex("^\\d{1,20}$")
    private val HTTP = Regex("^https?://", RegexOption.IGNORE_CASE)

    private fun JsonObject.raw(k: String): JsonElement? = this[k]?.takeIf { it !is JsonNull }
    private fun str(x: JsonElement?): String? = (x as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun num(x: JsonElement?): Double? = (x as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }
    private fun bool(x: JsonElement?): Boolean = (x as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
    private fun id(x: JsonElement?): String? = str(x)?.takeIf { ID.matches(it) }
    private fun href(x: JsonElement?): String? = str(x)?.takeIf { HTTP.containsMatchIn(it) && MessageCrypto.webLink(it) }
    private fun proxied(x: JsonElement?): String? = str(x)?.takeIf { it.startsWith("/media/proxy/") && MessageCrypto.webLink(it) }

    private fun media(x: JsonElement?): HookMedia? {
        val o = x as? JsonObject ?: return null
        val w = num(o.raw("width"))
        val h = num(o.raw("height"))
        val sized = w != null && h != null && w > 0 && h > 0
        val out = HookMedia(
            url = str(o.raw("url")) ?: "",
            proxyUrl = proxied(o.raw("proxy_url")),
            blobId = id(o.raw("blob_id")),
            attachmentId = id(o.raw("attachment_id")),
            width = if (sized) w else null,
            height = if (sized) h else null,
            contentType = str(o.raw("content_type"))?.takeIf { it.isNotEmpty() },
            description = str(o.raw("description"))?.takeIf { it.isNotEmpty() },
        )
        return if (out.proxyUrl != null || out.blobId != null) out else null
    }

    private fun emoji(x: JsonElement?): HookEmoji? {
        val o = x as? JsonObject ?: return null
        val out = HookEmoji(id(o.raw("id")), str(o.raw("name"))?.takeIf { it.isNotEmpty() }?.take(64), bool(o.raw("animated")))
        return if (out.id != null || out.name != null) out else null
    }

    private fun time(s: String?): Long? = s?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }

    private fun embed(x: JsonElement?): HookEmbed? {
        val o = x as? JsonObject ?: return null
        val color = num(o.raw("color"))?.takeIf { it >= 0 && it <= 0xffffff }?.toLong()
        val author = (o.raw("author") as? JsonObject)?.let { a ->
            str(a.raw("name"))?.takeIf { it.isNotEmpty() }?.let { HookEmbedAuthor(it, href(a.raw("url")), proxied(a.raw("proxy_icon_url")), id(a.raw("icon_blob_id"))) }
        }
        val footer = (o.raw("footer") as? JsonObject)?.let { f ->
            str(f.raw("text"))?.takeIf { it.isNotEmpty() }?.let { HookEmbedFooter(it, proxied(f.raw("proxy_icon_url")), id(f.raw("icon_blob_id"))) }
        }
        val fields = ((o.raw("fields") as? JsonArray) ?: JsonArray(emptyList())).take(25).mapNotNull { fv ->
            val f = fv as? JsonObject ?: return@mapNotNull null
            val name = str(f.raw("name")) ?: return@mapNotNull null
            val value = str(f.raw("value")) ?: return@mapNotNull null
            HookEmbedField(name, value, bool(f.raw("inline")))
        }
        return HookEmbed(
            type = str(o.raw("type")) ?: "rich",
            title = str(o.raw("title"))?.takeIf { it.isNotEmpty() },
            description = str(o.raw("description"))?.takeIf { it.isNotEmpty() },
            url = href(o.raw("url")),
            timestamp = time(str(o.raw("timestamp"))),
            color = color,
            author = author,
            footer = footer,
            image = media(o.raw("image")),
            thumbnail = media(o.raw("thumbnail")),
            fields = fields,
        )
    }

    private fun component(x: JsonElement?, depth: Int): HookComponent? {
        val o = x as? JsonObject ?: return null
        if (depth > 4) return null
        val type = num(o.raw("type"))?.toInt() ?: return null
        val items = ((o.raw("items") as? JsonArray) ?: JsonArray(emptyList())).take(10).mapNotNull { it ->
            val io = it as? JsonObject ?: return@mapNotNull null
            val im = media(io.raw("media")) ?: return@mapNotNull null
            HookItem(im, str(io.raw("description"))?.takeIf { d -> d.isNotEmpty() }, bool(io.raw("spoiler")))
        }
        return HookComponent(
            type = type,
            components = ((o.raw("components") as? JsonArray) ?: JsonArray(emptyList())).take(40).mapNotNull { component(it, depth + 1) },
            accessory = component(o.raw("accessory"), depth + 1),
            style = num(o.raw("style"))?.toInt(),
            label = str(o.raw("label"))?.takeIf { it.isNotEmpty() }?.take(80),
            emoji = emoji(o.raw("emoji")),
            url = href(o.raw("url")),
            disabled = bool(o.raw("disabled")),
            content = str(o.raw("content"))?.takeIf { it.isNotEmpty() },
            media = media(o.raw("media")),
            file = media(o.raw("file")),
            description = str(o.raw("description"))?.takeIf { it.isNotEmpty() },
            spoiler = bool(o.raw("spoiler")),
            name = str(o.raw("name"))?.takeIf { it.isNotEmpty() },
            size = num(o.raw("size"))?.takeIf { it >= 0 },
            items = items,
            divider = (o.raw("divider") as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull,
            spacing = num(o.raw("spacing"))?.toInt(),
            accentColor = num(o.raw("accent_color"))?.takeIf { it >= 0 && it <= 0xffffff }?.toLong(),
        )
    }

    private fun poll(x: JsonElement?): HookPoll? {
        val o = x as? JsonObject ?: return null
        val q = (o.raw("question") as? JsonObject)?.let { str(it.raw("text")) }?.takeIf { it.isNotEmpty() } ?: return null
        val answersRaw = o.raw("answers") as? JsonArray ?: return null
        val answers = answersRaw.take(10).mapNotNull { a ->
            val ao = a as? JsonObject ?: return@mapNotNull null
            val aid = num(ao.raw("answer_id"))?.toInt() ?: return@mapNotNull null
            val pm = ao.raw("poll_media") as? JsonObject ?: return@mapNotNull null
            HookPollAnswer(aid, str(pm.raw("text")) ?: "", emoji(pm.raw("emoji")))
        }
        if (answers.isEmpty()) return null
        return HookPoll(q, answers, time(str(o.raw("expiry"))) ?: 0L, bool(o.raw("allow_multiselect")))
    }

    private fun attachment(x: JsonElement?): HookAttachment? {
        val o = x as? JsonObject ?: return null
        val aid = id(o.raw("id")) ?: return null
        val blob = id(o.raw("blob_id")) ?: return null
        val filename = str(o.raw("filename")) ?: return null
        val size = num(o.raw("size"))?.takeIf { it >= 0 } ?: return null
        val w = num(o.raw("width"))
        val h = num(o.raw("height"))
        val sized = w != null && h != null && w > 0 && h > 0
        return HookAttachment(
            id = aid, blobId = blob, filename = filename, size = size.toLong(),
            title = str(o.raw("title"))?.takeIf { it.isNotEmpty() },
            description = str(o.raw("description"))?.takeIf { it.isNotEmpty() },
            contentType = str(o.raw("content_type"))?.takeIf { it.isNotEmpty() },
            width = if (sized) w else null, height = if (sized) h else null,
            spoiler = bool(o.raw("spoiler")),
            duration = num(o.raw("duration_secs"))?.takeIf { it > 0 },
            inline = bool(o.raw("inline")),
        )
    }

    /** sanitizeHook: the webhook content held to what can be drawn, or null when it is not an object at all. */
    fun sanitize(raw: JsonElement?): HookContent? {
        val o = raw as? JsonObject ?: return null
        val linkEmbeds = ((o.raw("link_embeds") as? JsonArray) ?: JsonArray(emptyList())).take(5)
            .mapNotNull { e -> (e as? JsonObject)?.takeIf { (it["url"] as? JsonPrimitive)?.isString == true } }
            .map { MessageCrypto.sanitizeEmbed(it) }
            .filter { (it["url"] as? JsonPrimitive)?.isString == true }
        return HookContent(
            name = (str(o.raw("name")) ?: "").take(80).ifEmpty { "Webhook" },
            avatarId = id(o.raw("avatar_id")),
            avatarProxyUrl = proxied(o.raw("avatar_proxy_url")),
            avatarUrl = href(o.raw("avatar_url")),
            content = str(o.raw("content")) ?: "",
            tts = bool(o.raw("tts")),
            embeds = ((o.raw("embeds") as? JsonArray) ?: JsonArray(emptyList())).take(10).mapNotNull { embed(it) },
            components = ((o.raw("components") as? JsonArray) ?: JsonArray(emptyList())).take(40).mapNotNull { component(it, 0) },
            poll = poll(o.raw("poll")),
            attachments = ((o.raw("attachments") as? JsonArray) ?: JsonArray(emptyList())).take(10).mapNotNull { attachment(it) },
            linkEmbeds = linkEmbeds,
            source = str(o.raw("source"))?.takeIf { it.isNotEmpty() },
        )
    }

    private val parsed = Collections.synchronizedMap(WeakHashMap<JsonObject, HookContent>())

    /** The typed content of a message's webhook object, read once per object. */
    fun of(hook: JsonObject?): HookContent? {
        if (hook == null) return null
        parsed[hook]?.let { return it }
        val out = sanitize(hook) ?: return null
        parsed[hook] = out
        return out
    }

    /** A webhook's file as an attachment: stored as sent, so no key. */
    fun attachmentMeta(a: HookAttachment): AttachmentMeta = AttachmentMeta(
        blobId = a.blobId,
        name = a.filename,
        type = a.contentType ?: "application/octet-stream",
        size = a.size,
        key = "",
        w = a.width,
        h = a.height,
        spoiler = if (a.spoiler) true else null,
        duration = a.duration,
        plain = true,
        alt = a.description,
    )

    /** The files a webhook message lists under its words (inline ones are drawn by its components instead). */
    fun listedAttachments(h: HookContent): List<AttachmentMeta> = h.attachments.filter { !it.inline }.map { attachmentMeta(it) }

    fun mediaAttachment(h: HookContent, m: HookMedia): AttachmentMeta? {
        val blob = m.blobId ?: return null
        return h.attachments.firstOrNull { it.blobId == blob }?.let { attachmentMeta(it) }
    }

    /** Everything it says in words, for search, notifications and reply quotes. */
    fun text(h: HookContent): String {
        val parts = ArrayList<String>()
        if (h.content.isNotEmpty()) parts += h.content
        for (e in h.embeds) {
            for (s in listOfNotNull(e.author?.name, e.title, e.description) + e.fields.flatMap { listOf(it.name, it.value) } + listOfNotNull(e.footer?.text)) {
                if (s.isNotEmpty()) parts += s
            }
        }
        fun walk(list: List<HookComponent>) {
            for (c in list) {
                if (c.type == C_TEXT && c.content != null) parts += c.content
                walk(c.components)
                c.accessory?.let { walk(listOf(it)) }
            }
        }
        walk(h.components)
        h.poll?.let { p -> parts += p.question; parts += p.answers.map { it.text } }
        return parts.joinToString("\n")
    }
}
