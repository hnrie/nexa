package fish.nexa.markdown

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.ui.markdown.Webhook
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.AfterClass
import org.junit.BeforeClass
import org.junit.Test
import java.util.TimeZone
import java.util.zip.GZIPInputStream

/** Webhook messages (lib/webhookMessage.ts), good and mangled, against the web. */
class WebhookVectorsTest {
    companion object {
        private var zone: TimeZone? = null

        @BeforeClass
        @JvmStatic
        fun setUp() {
            zone = TimeZone.getDefault()
            // the vectors were made in this zone: a time without an offset is read as local time
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"))
        }

        @AfterClass
        @JvmStatic
        fun tearDown() {
            zone?.let { TimeZone.setDefault(it) }
        }
    }

    private val data: JsonObject by lazy {
        val stream = WebhookVectorsTest::class.java.classLoader!!.getResourceAsStream("web-hook-vectors.json.gz")!!
        GZIPInputStream(stream).use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
    }

    private val cases: List<JsonObject> get() = data["cases"]!!.jsonArray.map { it.jsonObject }

    /** ISO 8601, which is what webhooks send; for anything else V8 guesses (Date.parse("-5") is May 2001), and the app does not. */
    private val ISO = Regex("^[+-]?\\d{4,6}(?:-|$)")

    /**
     * The web's answer with the times it guessed from text that is no ISO date
     * taken out, and file sizes as whole numbers (the app's AttachmentMeta keeps bytes as a Long).
     */
    private fun comparable(e: JsonElement?): JsonElement? = when (e) {
        is JsonObject -> JsonObject(e.mapNotNull { (k, v) ->
            if ((k == "timestamp" || k == "expiry") && v is JsonPrimitive && !v.isString) null
            else if (k == "size" && v is JsonPrimitive && !v.isString) k to JsonPrimitive(Math.floor(v.content.toDouble()))
            else k to comparable(v)!!
        }.toMap())
        is JsonArray -> JsonArray(e.map { comparable(it)!! })
        else -> e
    }

    @Test
    fun isoDates() {
        val dates = data["dates"]!!.jsonArray.map { it.jsonObject }.filter { ISO.containsMatchIn(it["s"]!!.jsonPrimitive.content) }
        Vectors.expectAll("Date.parse (ISO 8601)", dates) { d ->
            val s = d["s"]!!.jsonPrimitive.content
            val want = d["ms"]!!.takeIf { it !is JsonNull }?.jsonPrimitive?.content?.toDouble()
            val got = Webhook.parseDate(s)
            if (got == want) null else "date ${Vectors.show(s)}: web $want kotlin $got"
        }
    }

    private fun JsonObjectBuilder.opt(k: String, v: String?) {
        if (v != null) put(k, v)
    }

    private fun JsonObjectBuilder.opt(k: String, v: Double?) {
        if (v != null) put(k, v)
    }

    private fun JsonObjectBuilder.flag(k: String, v: Boolean) {
        if (v) put(k, true)
    }

    private fun media(m: Webhook.Media?): JsonObject? = m?.let {
        buildJsonObject {
            put("url", it.url)
            opt("proxy_url", it.proxyUrl)
            opt("blob_id", it.blobId)
            opt("attachment_id", it.attachmentId)
            opt("width", it.width)
            opt("height", it.height)
            opt("content_type", it.contentType)
            opt("description", it.description)
        }
    }

    private fun emoji(e: Webhook.Emoji?): JsonObject? = e?.let {
        buildJsonObject {
            opt("id", it.id)
            opt("name", it.name)
            flag("animated", it.animated)
        }
    }

    private fun component(c: Webhook.Component): JsonObject = buildJsonObject {
        put("type", c.type)
        put("components", buildJsonArray { for (x in c.components) add(component(x)) })
        put("items", buildJsonArray {
            for (it in c.items) add(buildJsonObject {
                put("media", media(it.media)!!)
                opt("description", it.description)
                flag("spoiler", it.spoiler)
            })
        })
        c.accessory?.let { put("accessory", component(it)) }
        opt("style", c.style)
        opt("label", c.label)
        emoji(c.emoji)?.let { put("emoji", it) }
        opt("url", c.url)
        flag("disabled", c.disabled)
        opt("content", c.content)
        media(c.media)?.let { put("media", it) }
        media(c.file)?.let { put("file", it) }
        opt("description", c.description)
        flag("spoiler", c.spoiler)
        opt("name", c.name)
        opt("size", c.size)
        c.divider?.let { put("divider", it) }
        opt("spacing", c.spacing)
        opt("accent_color", c.accentColor)
        opt("placeholder", c.placeholder)
    }

    private fun content(h: Webhook.Content): JsonObject = buildJsonObject {
        put("name", h.name)
        put("content", h.content)
        put("tts", h.tts)
        put("embeds", buildJsonArray {
            for (e in h.embeds) add(buildJsonObject {
                put("type", e.type)
                put("fields", buildJsonArray { for (f in e.fields) add(buildJsonObject { put("name", f.name); put("value", f.value); put("inline", f.inline) }) })
                opt("title", e.title)
                opt("description", e.description)
                opt("url", e.url)
                opt("timestamp", e.timestamp)
                e.color?.let { put("color", it) }
                e.author?.let { a -> put("author", buildJsonObject { put("name", a.name); opt("url", a.url); opt("proxy_icon_url", a.proxyIconUrl); opt("icon_blob_id", a.iconBlobId) }) }
                e.footer?.let { f -> put("footer", buildJsonObject { put("text", f.text); opt("proxy_icon_url", f.proxyIconUrl); opt("icon_blob_id", f.iconBlobId) }) }
                media(e.image)?.let { put("image", it) }
                media(e.thumbnail)?.let { put("thumbnail", it) }
            })
        })
        put("components", buildJsonArray { for (c in h.components) add(component(c)) })
        put("attachments", buildJsonArray {
            for (a in h.attachments) add(buildJsonObject {
                put("id", a.id); put("blob_id", a.blobId); put("filename", a.filename); put("size", a.size)
                opt("title", a.title); opt("description", a.description); opt("content_type", a.contentType)
                opt("width", a.width); opt("height", a.height)
                flag("spoiler", a.spoiler); flag("inline", a.inline); opt("duration", a.duration)
            })
        })
        put("link_embeds", JsonArray(h.linkEmbeds))
        opt("avatar_id", h.avatarId)
        opt("avatar_proxy_url", h.avatarProxyUrl)
        opt("avatar_url", h.avatarUrl)
        h.poll?.let { p ->
            put("poll", buildJsonObject {
                put("question", p.question)
                put("answers", buildJsonArray { for (a in p.answers) add(buildJsonObject { put("answer_id", a.answerId); put("text", a.text); emoji(a.emoji)?.let { put("emoji", it) } }) })
                put("expiry", p.expiry)
                put("allow_multiselect", p.allowMultiselect)
            })
        }
        opt("source", h.source)
    }

    private fun meta(m: AttachmentMeta): JsonObject = buildJsonObject {
        put("blob_id", m.blobId); put("name", m.name); put("type", m.type); put("size", m.size); put("key", m.key); put("plain", m.plain)
        opt("w", m.w); opt("h", m.h)
        if (m.spoiler == true) put("spoiler", true)
        opt("duration", m.duration)
        opt("alt", m.alt)
    }

    @Test
    fun sanitize() {
        val base = Webhook.sanitize(cases[0]["raw"])
        Vectors.expectAll("sanitizeHook / hookText / listedAttachments / mediaAttachment / sameHookSender", cases) { c ->
            val got = Webhook.sanitize(c["raw"])
            val want = c["out"]!!
            if (want is JsonNull || got == null) {
                return@expectAll if ((want is JsonNull) == (got == null)) null else "raw ${c["raw"].toString().take(600)}\nweb $want\nkotlin $got"
            }
            val problems = ArrayList<String>()
            val json = comparable(content(got))
            if (!Vectors.same(json, comparable(want))) problems += "out\nweb    ${want.toString().take(2000)}\nkotlin ${json.toString().take(2000)}"
            if (Webhook.text(got) != c["text"]!!.jsonPrimitive.contentOrNull) problems += "text web ${c["text"]} kotlin ${Webhook.text(got)}"
            val listed = buildJsonArray { for (m in Webhook.listedAttachments(got)) add(meta(m)) }
            if (!Vectors.same(listed, comparable(c["listed"]))) problems += "listed web ${c["listed"]} kotlin $listed"
            val thumb = got.embeds.firstOrNull()?.thumbnail
            val media: JsonElement = thumb?.let { Webhook.mediaAttachment(got, it) }?.let(::meta) ?: JsonNull
            if (!Vectors.same(media, comparable(c["media"]))) problems += "media web ${c["media"]} kotlin $media"
            if (Webhook.sameSender(got, base) != c["same"]!!.jsonPrimitive.contentOrNull?.toBoolean()) problems += "same"
            if (problems.isEmpty()) null else "raw ${c["raw"].toString().take(800)}\n" + problems.joinToString("\n")
        }
    }
}
