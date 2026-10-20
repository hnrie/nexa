package fish.nexa.ui.markdown

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.MessageCrypto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Messages a webhook posted (lib/webhookMessage.ts). A webhook's message
 * reaches the server readable (there is no key to seal it with), in the
 * shape of Discord's message, embed, component and poll objects; it is the
 * one kind that is not end-to-end encrypted, and the app says so wherever it
 * is shown. Everything is read defensively: a wrong type must not crash the
 * client.
 *
 * An app's messages come the same way and in the same shape, with
 * `application_id` naming the app and, on an answer to something someone
 * used, `interaction` saying who used what. Their buttons and select menus do
 * something: the app answers them (data/Interactions).
 */
object Webhook {
    data class Media(
        val url: String,
        /** A remote picture, through this server's media proxy. */
        val proxyUrl: String? = null,
        /** One of the message's own files. */
        val blobId: String? = null,
        val attachmentId: String? = null,
        val width: Double? = null,
        val height: Double? = null,
        val contentType: String? = null,
        val description: String? = null,
    )

    data class Author(val name: String, val url: String? = null, val proxyIconUrl: String? = null, val iconBlobId: String? = null)

    data class Footer(val text: String, val proxyIconUrl: String? = null, val iconBlobId: String? = null)

    data class Field(val name: String, val value: String, val inline: Boolean)

    data class Embed(
        val type: String,
        val title: String? = null,
        val description: String? = null,
        val url: String? = null,
        /** Milliseconds, from the embed's ISO 8601 timestamp. */
        val timestamp: Double? = null,
        val color: Int? = null,
        val author: Author? = null,
        val footer: Footer? = null,
        val image: Media? = null,
        val thumbnail: Media? = null,
        val fields: List<Field> = emptyList(),
    )

    data class Emoji(val id: String? = null, val name: String? = null, val animated: Boolean = false)

    data class GalleryItem(val media: Media, val description: String? = null, val spoiler: Boolean = false)

    /** One component; which fields mean anything depends on `type` (the C_ constants). */
    data class Component(
        val type: Double,
        val components: List<Component> = emptyList(),
        val accessory: Component? = null,
        val style: Double? = null,
        val label: String? = null,
        val emoji: Emoji? = null,
        val url: String? = null,
        val disabled: Boolean = false,
        val content: String? = null,
        val media: Media? = null,
        val file: Media? = null,
        val description: String? = null,
        val spoiler: Boolean = false,
        val name: String? = null,
        val size: Double? = null,
        val items: List<GalleryItem> = emptyList(),
        val divider: Boolean? = null,
        val spacing: Double? = null,
        val accentColor: Double? = null,
        val placeholder: String? = null,
        /** What the app is told was used: buttons other than links, and select menus. */
        val customId: String? = null,
        /** A string select menu's choices. */
        val options: List<SelectOption> = emptyList(),
        val minValues: Double? = null,
        val maxValues: Double? = null,
        /** What a person, role, mentionable or channel select menu starts with picked. */
        val defaultValues: List<DefaultValue> = emptyList(),
        /** The kinds of channel a channel select menu offers (the protocol's numbers). */
        val channelTypes: List<Double>? = null,
    ) {
        /** Whether it is a component of this type (one of the C_ constants). */
        fun isType(n: Int): Boolean = type == n.toDouble()
    }

    /** One choice of a select menu. */
    data class SelectOption(val label: String, val value: String, val description: String? = null, val emoji: Emoji? = null, val default: Boolean = false)

    /** Something a select menu starts with picked: `type` is user, role or channel. */
    data class DefaultValue(val id: String, val type: String)

    /** What someone used that an app's message answers. */
    data class Interaction(
        val id: String,
        /** 2 a command, 3 a button or select menu, 5 a form. */
        val type: Double,
        val userId: String,
        /** The command's name, with its subcommands ("config set"). */
        val name: String? = null,
        /** 1 typed, 2 from a person's menu, 3 from a message's menu. */
        val commandType: Double? = null,
        val targetUserId: String? = null,
        val targetMessageId: String? = null,
        /** For a followup, the message the first answer made. */
        val originalResponseMessageId: String? = null,
        /** For a form's answer, what opened the form. */
        val trigger: Interaction? = null,
    )

    /** A sticker an app sent; `format` is the file's kind as Nexa keeps it (png, apng, gif, webp, tgs, webm). */
    data class Sticker(val id: String, val name: String, val blobId: String, val format: String? = null)

    data class PollAnswer(val answerId: Double, val text: String, val emoji: Emoji? = null)

    /** `expiry`: when it closes, in milliseconds (0 when unknown). */
    data class Poll(val question: String, val answers: List<PollAnswer>, val expiry: Double, val allowMultiselect: Boolean)

    data class Attachment(
        val id: String,
        val blobId: String,
        val filename: String,
        val size: Double,
        val title: String? = null,
        val description: String? = null,
        val contentType: String? = null,
        val width: Double? = null,
        val height: Double? = null,
        val spoiler: Boolean = false,
        val duration: Double? = null,
        /** Shown inside an embed or a component, so not listed under the message. */
        val inline: Boolean = false,
    )

    data class Content(
        /** Who the message says it is from. */
        val name: String,
        val content: String,
        val tts: Boolean,
        val embeds: List<Embed>,
        val components: List<Component>,
        val attachments: List<Attachment>,
        /** Previews the server fetched for the links in the content (sanitised unfurl objects). */
        val linkEmbeds: List<JsonObject>,
        /** Its picture: the webhook's own (an avatar blob), or one sent with the message (proxied). */
        val avatarId: String? = null,
        val avatarProxyUrl: String? = null,
        /** The address the picture was sent as, to tell senders apart; only ever loaded through the proxy. */
        val avatarUrl: String? = null,
        val poll: Poll? = null,
        val source: String? = null,
        /** The app that wrote it, for an app's message (its bot is the message's author). */
        val applicationId: String? = null,
        /** What someone used that this answers. */
        val interaction: Interaction? = null,
        val stickers: List<Sticker> = emptyList(),
    )

    // Component types and button styles, at Discord's numbers.
    const val C_ACTION_ROW = 1
    const val C_BUTTON = 2
    const val C_SECTION = 9
    const val C_TEXT = 10
    const val C_THUMBNAIL = 11
    const val C_GALLERY = 12
    const val C_FILE = 13
    const val C_SEPARATOR = 14
    const val C_CONTAINER = 17
    const val C_STRING_SELECT = 3
    const val C_USER_SELECT = 5
    const val C_ROLE_SELECT = 6
    const val C_MENTIONABLE_SELECT = 7
    const val C_CHANNEL_SELECT = 8
    const val BUTTON_PRIMARY = 1
    const val BUTTON_SECONDARY = 2
    const val BUTTON_SUCCESS = 3
    const val BUTTON_DANGER = 4
    const val BUTTON_LINK = 5
    const val BUTTON_PREMIUM = 6

    /** Whether a component's type is a select menu of any kind. */
    fun isSelect(type: Double): Boolean = type == C_STRING_SELECT.toDouble() || (type >= C_USER_SELECT && type <= C_CHANNEL_SELECT)

    private fun obj(x: JsonElement?): JsonObject? = x as? JsonObject
    private fun str(x: JsonElement?): String? = (x as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun num(x: JsonElement?): Double? = (x as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull && it.booleanOrNull == null }?.doubleOrNull?.takeIf { it.isFinite() }
    private fun isTrue(x: JsonElement?): Boolean = (x as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
    private fun bool(x: JsonElement?): Boolean? = (x as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
    private fun id(x: JsonElement?): String? = str(x)?.takeIf { it.length in 1..20 && it.all { c -> c in '0'..'9' } }
    private fun arr(x: JsonElement?): JsonArray? = x as? JsonArray

    /** `s.slice(0, n)` in UTF-16 units. */
    private fun slice(s: String, n: Int) = if (s.length > n) s.substring(0, n) else s

    /** A link a reader may follow: http(s) only. */
    private fun href(x: JsonElement?): String? = str(x)?.takeIf { Js.regionMatchesAsciiIgnoreCase(it, 0, "http://") || Js.regionMatchesAsciiIgnoreCase(it, 0, "https://") }?.takeIf { MessageCrypto.webLink(it) }

    /** A picture's address on this server: its media proxy, and nothing else. */
    private fun proxied(x: JsonElement?): String? = str(x)?.takeIf { it.startsWith("/media/proxy/") && MessageCrypto.webLink(it) }

    private fun media(x: JsonElement?): Media? {
        val o = obj(x) ?: return null
        val w = num(o["width"])
        val h = num(o["height"])
        val sized = w != null && h != null && w != 0.0 && h != 0.0 && w > 0 && h > 0
        val out = Media(
            url = str(o["url"]) ?: "",
            proxyUrl = proxied(o["proxy_url"]),
            blobId = id(o["blob_id"]),
            attachmentId = id(o["attachment_id"]),
            width = if (sized) w else null,
            height = if (sized) h else null,
            contentType = str(o["content_type"])?.takeIf { it.isNotEmpty() },
            description = str(o["description"])?.takeIf { it.isNotEmpty() },
        )
        return if (out.proxyUrl != null || out.blobId != null) out else null
    }

    private fun emoji(x: JsonElement?): Emoji? {
        val o = obj(x) ?: return null
        val out = Emoji(id(o["id"]), str(o["name"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 64) }, isTrue(o["animated"]))
        return if (out.id != null || out.name != null) out else null
    }

    private fun embed(x: JsonElement?): Embed? {
        val o = obj(x) ?: return null
        val color = num(o["color"])?.takeIf { it >= 0 && it <= 0xffffff }?.let { Math.floor(it).toInt() }
        val a = obj(o["author"])
        val author = if (a != null && !str(a["name"]).isNullOrEmpty()) Author(str(a["name"])!!, href(a["url"]), proxied(a["proxy_icon_url"]), id(a["icon_blob_id"])) else null
        val f = obj(o["footer"])
        val footer = if (f != null && !str(f["text"]).isNullOrEmpty()) Footer(str(f["text"])!!, proxied(f["proxy_icon_url"]), id(f["icon_blob_id"])) else null
        val fields = ArrayList<Field>()
        arr(o["fields"])?.take(25)?.forEach { fv ->
            val fo = obj(fv) ?: return@forEach
            val name = str(fo["name"]) ?: return@forEach
            val value = str(fo["value"]) ?: return@forEach
            fields += Field(name, value, isTrue(fo["inline"]))
        }
        return Embed(
            type = str(o["type"]) ?: "rich",
            title = str(o["title"])?.takeIf { it.isNotEmpty() },
            description = str(o["description"])?.takeIf { it.isNotEmpty() },
            url = href(o["url"]),
            timestamp = str(o["timestamp"])?.takeIf { it.isNotEmpty() }?.let(::parseDate),
            color = color,
            author = author,
            footer = footer,
            image = media(o["image"]),
            thumbnail = media(o["thumbnail"]),
            fields = fields,
        )
    }

    private fun component(x: JsonElement?, depth: Int): Component? {
        val o = obj(x) ?: return null
        if (depth > 4) return null
        val type = num(o["type"]) ?: return null
        val items = ArrayList<GalleryItem>()
        arr(o["items"])?.take(10)?.forEach { it ->
            val io = obj(it) ?: return@forEach
            val m = media(io["media"]) ?: return@forEach
            items += GalleryItem(m, str(io["description"])?.takeIf { d -> d.isNotEmpty() }, isTrue(io["spoiler"]))
        }
        return Component(
            type = type,
            components = arr(o["components"])?.take(40)?.mapNotNull { component(it, depth + 1) } ?: emptyList(),
            accessory = component(o["accessory"], depth + 1),
            style = num(o["style"]),
            label = str(o["label"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 80) },
            emoji = emoji(o["emoji"]),
            url = href(o["url"]),
            disabled = isTrue(o["disabled"]),
            content = str(o["content"])?.takeIf { it.isNotEmpty() },
            media = media(o["media"]),
            file = media(o["file"]),
            description = str(o["description"])?.takeIf { it.isNotEmpty() },
            spoiler = isTrue(o["spoiler"]),
            name = str(o["name"])?.takeIf { it.isNotEmpty() },
            size = num(o["size"])?.takeIf { it >= 0 },
            items = items,
            divider = bool(o["divider"]),
            spacing = num(o["spacing"]),
            accentColor = num(o["accent_color"])?.takeIf { it >= 0 && it <= 0xffffff },
            placeholder = str(o["placeholder"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 150) },
            customId = str(o["custom_id"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 100) },
            options = arr(o["options"])?.take(25)?.mapNotNull { ov ->
                val oo = obj(ov) ?: return@mapNotNull null
                val label = str(oo["label"]) ?: return@mapNotNull null
                val value = str(oo["value"]) ?: return@mapNotNull null
                SelectOption(slice(label, 100), slice(value, 100), str(oo["description"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 100) }, emoji(oo["emoji"]), bool(oo["default"]) == true)
            } ?: emptyList(),
            minValues = num(o["min_values"])?.takeIf { it >= 0 && it <= 25 }?.let { Math.floor(it) },
            maxValues = num(o["max_values"])?.takeIf { it >= 1 && it <= 25 }?.let { Math.floor(it) },
            defaultValues = arr(o["default_values"])?.take(25)?.mapNotNull { dv ->
                val d = obj(dv) ?: return@mapNotNull null
                val did = id(d["id"]) ?: return@mapNotNull null
                val dt = str(d["type"])?.takeIf { it == "user" || it == "role" || it == "channel" } ?: return@mapNotNull null
                DefaultValue(did, dt)
            } ?: emptyList(),
            channelTypes = arr(o["channel_types"])?.mapNotNull { num(it) }?.take(20),
        )
    }

    private fun interaction(x: JsonElement?, depth: Int = 0): Interaction? {
        val o = obj(x) ?: return null
        if (depth > 1) return null
        val iid = id(o["id"]) ?: return null
        val uid = id(o["user_id"]) ?: return null
        val type = num(o["type"]) ?: return null
        return Interaction(
            id = iid, type = type, userId = uid,
            name = str(o["name"])?.takeIf { it.isNotEmpty() }?.let { slice(it, 100) },
            commandType = num(o["command_type"]),
            targetUserId = id(o["target_user_id"]),
            targetMessageId = id(o["target_message_id"]),
            originalResponseMessageId = id(o["original_response_message_id"]),
            trigger = interaction(o["trigger"], depth + 1),
        )
    }

    private val STICKER_FORMAT = Regex("^(png|apng|gif|webp|tgs|webm)$")

    private fun sticker(x: JsonElement?): Sticker? {
        val o = obj(x) ?: return null
        val sid = id(o["id"]) ?: return null
        val blob = id(o["blob_id"]) ?: return null
        return Sticker(sid, slice(str(o["name"]) ?: "", 30), blob, str(o["format"])?.takeIf { STICKER_FORMAT.matches(it) })
    }

    private fun poll(x: JsonElement?): Poll? {
        val o = obj(x) ?: return null
        val q = obj(o["question"])?.let { str(it["text"]) }
        val list = arr(o["answers"])
        if (q.isNullOrEmpty() || list == null) return null
        val answers = ArrayList<PollAnswer>()
        for (a in list.take(10)) {
            val ao = obj(a) ?: continue
            val aid = num(ao["answer_id"]) ?: continue
            val pm = obj(ao["poll_media"]) ?: continue
            answers += PollAnswer(aid, str(pm["text"]) ?: "", emoji(pm["emoji"]))
        }
        if (answers.isEmpty()) return null
        val expiry = parseDate(str(o["expiry"]) ?: "") ?: 0.0
        return Poll(q, answers, expiry, isTrue(o["allow_multiselect"]))
    }

    private fun attachment(x: JsonElement?): Attachment? {
        val o = obj(x) ?: return null
        val aid = id(o["id"]) ?: return null
        val blob = id(o["blob_id"]) ?: return null
        val filename = str(o["filename"]) ?: return null
        val size = num(o["size"])?.takeIf { it >= 0 } ?: return null
        val w = num(o["width"])
        val h = num(o["height"])
        val sized = w != null && h != null && w != 0.0 && h != 0.0 && w > 0 && h > 0
        return Attachment(
            id = aid, blobId = blob, filename = filename, size = size,
            title = str(o["title"])?.takeIf { it.isNotEmpty() },
            description = str(o["description"])?.takeIf { it.isNotEmpty() },
            contentType = str(o["content_type"])?.takeIf { it.isNotEmpty() },
            width = if (sized) w else null,
            height = if (sized) h else null,
            spoiler = isTrue(o["spoiler"]),
            duration = num(o["duration_secs"])?.takeIf { it != 0.0 },
            inline = isTrue(o["inline"]),
        )
    }

    /** Reads a webhook message's content, or null for anything that is not one. */
    fun sanitize(raw: JsonElement?): Content? {
        val o = obj(raw) ?: return null
        return Content(
            name = slice(str(o["name"]) ?: "", 80).ifEmpty { "Webhook" },
            content = str(o["content"]) ?: "",
            tts = isTrue(o["tts"]),
            embeds = arr(o["embeds"])?.take(10)?.mapNotNull(::embed) ?: emptyList(),
            components = arr(o["components"])?.take(40)?.mapNotNull { component(it, 0) } ?: emptyList(),
            attachments = arr(o["attachments"])?.take(10)?.mapNotNull(::attachment) ?: emptyList(),
            linkEmbeds = arr(o["link_embeds"])?.take(5)
                ?.mapNotNull { e -> (e as? JsonObject)?.takeIf { str(it["url"]) != null } }
                ?.map { MessageCrypto.sanitizeEmbed(it) }
                ?.filter { str(it["url"]) != null } ?: emptyList(),
            avatarId = id(o["avatar_id"]),
            avatarProxyUrl = proxied(o["avatar_proxy_url"]),
            avatarUrl = href(o["avatar_url"]),
            poll = poll(o["poll"]),
            source = str(o["source"])?.takeIf { it.isNotEmpty() },
            applicationId = id(o["application_id"]),
            interaction = interaction(o["interaction"]),
            stickers = arr(o["stickers"])?.take(3)?.mapNotNull(::sticker) ?: emptyList(),
        )
    }

    private val parsed = java.util.Collections.synchronizedMap(java.util.WeakHashMap<JsonObject, Content>())

    /** The content of a message's webhook object, read once per object. */
    fun of(hook: JsonElement?): Content? {
        val o = hook as? JsonObject ?: return null
        parsed[o]?.let { return it }
        val out = sanitize(o) ?: return null
        parsed[o] = out
        return out
    }

    /** A webhook's file as the attachment views take one: downloaded as it is, never decrypted. */
    fun attachmentMeta(a: Attachment): AttachmentMeta {
        val sized = a.width != null && a.height != null
        return AttachmentMeta(
            blobId = a.blobId, name = a.filename, type = a.contentType ?: "application/octet-stream", size = a.size.toLong(), key = "",
            w = if (sized) a.width else null, h = if (sized) a.height else null,
            spoiler = if (a.spoiler) true else null, duration = a.duration, plain = true, alt = a.description,
        )
    }

    /** The files to list under a webhook message: the ones no embed or component shows. */
    fun listedAttachments(h: Content): List<AttachmentMeta> = h.attachments.filter { !it.inline }.map(::attachmentMeta)

    /** The attachment a picture points at, as the views take one. */
    fun mediaAttachment(h: Content, m: Media): AttachmentMeta? {
        val blob = m.blobId ?: return null
        return h.attachments.firstOrNull { it.blobId == blob }?.let(::attachmentMeta)
    }

    /** Everything it says in words, for search, notifications and a reply's line: its content, else its embeds' and components' text. */
    fun text(h: Content): String {
        val parts = ArrayList<String>()
        if (h.content.isNotEmpty()) parts += h.content
        for (e in h.embeds) {
            for (s in listOf(e.author?.name, e.title, e.description) + e.fields.flatMap { listOf(it.name, it.value) } + listOf(e.footer?.text)) {
                if (!s.isNullOrEmpty()) parts += s
            }
        }
        fun walk(list: List<Component>) {
            for (c in list) {
                if (c.type == C_TEXT.toDouble() && !c.content.isNullOrEmpty()) parts += c.content
                walk(c.components)
                c.accessory?.let { walk(listOf(it)) }
            }
        }
        walk(h.components)
        h.poll?.let { p ->
            parts += p.question
            parts += p.answers.map { it.text }
        }
        return parts.joinToString("\n")
    }

    /** Whether two webhook messages look like they came from the same sender, for grouping them. */
    fun sameSender(a: Content?, b: Content?): Boolean {
        if (a == null || b == null) return a == null && b == null
        // an app's messages are its bot's, which the rows group by author
        if (a.applicationId != null || b.applicationId != null) return a.applicationId == b.applicationId
        return a.name == b.name && a.avatarId == b.avatarId && a.avatarUrl == b.avatarUrl
    }

    /**
     * Whether a message goes by the name and picture it was sent with: a
     * webhook's. An app's messages are its bot's, and go by the bot's name,
     * like anyone's, though their content is read here.
     */
    fun namedByHook(webhookId: String?, hook: JsonElement?): Boolean = webhookId != null && hook is JsonObject

    /**
     * `Date.parse` for the ISO 8601 forms webhooks send: a date alone is UTC,
     * a date and time without an offset is the phone's local time. Null when
     * it is no date.
     */
    fun parseDate(s: String): Double? {
        val t = s.trim()
        if (t.isEmpty()) return null
        iso(t)?.let { return it }
        return try {
            OffsetDateTime.parse(t, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli().toDouble()
        } catch (_: Exception) {
            null
        }
    }

    private val ISO_DATE = Regex("^([+-]\\d{6}|\\d{4})(?:-(\\d{2})(?:-(\\d{2}))?)?(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:\\d{2})?)?$")

    /**
     * The ECMAScript date-time string format as V8 reads it: day 1 to 31 in
     * any month (the 30th of February runs on into March), 24:00 as the end of
     * the day, and local time for a date and time without an offset.
     */
    private fun iso(t: String): Double? {
        val m = ISO_DATE.find(t) ?: return null
        val g = m.groupValues
        if (g[1] == "-000000") return null
        val year = g[1].toInt()
        val month = g[2].ifEmpty { "1" }.toInt()
        val day = g[3].ifEmpty { "1" }.toInt()
        if (month !in 1..12 || day !in 1..31) return null
        val timed = g[4].isNotEmpty()
        val hour = if (timed) g[4].toInt() else 0
        val minute = if (timed) g[5].toInt() else 0
        val second = g[6].ifEmpty { "0" }.toInt()
        val millis = if (g[7].isEmpty()) 0 else (g[7] + "00").substring(0, 3).toInt()
        if (hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute != 0 || second != 0 || millis != 0))) return null
        val date = LocalDate.of(year, month, 1).plusDays((day - 1).toLong())
        val dateTime = date.atStartOfDay().plusHours(hour.toLong()).plusMinutes(minute.toLong()).plusSeconds(second.toLong()).plusNanos(millis * 1_000_000L)
        val zone = g[8]
        val instant = when {
            zone == "Z" || (zone.isEmpty() && !timed) -> dateTime.toInstant(ZoneOffset.UTC)
            zone.isNotEmpty() -> {
                val sign = if (zone[0] == '-') -1 else 1
                val oh = zone.substring(1, 3).toInt()
                val om = zone.substring(4, 6).toInt()
                if (oh > 23 || om > 59) return null
                dateTime.toInstant(ZoneOffset.ofTotalSeconds(sign * (oh * 3600 + om * 60)))
            }
            else -> dateTime.atZone(ZoneId.systemDefault()).toInstant()
        }
        return instant.toEpochMilli().toDouble()
    }
}
