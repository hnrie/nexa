package fish.nexa.search

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.MessageCrypto
import fish.nexa.crypto.PollPayload
import fish.nexa.crypto.StickerRef
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** A link preview as the message carries it, trimmed to what a result shows. */
data class LinkPreview(
    val url: String,
    val type: String? = null,
    val title: String? = null,
    val site: String? = null,
    val description: String? = null,
    val image: String? = null,
    val w: Double? = null,
    val h: Double? = null,
    val mime: String? = null,
)

/**
 * What the search index keeps of a message (web/src/search/doc.ts): enough to
 * find it (its words, who wrote it, where, when, what it carries) and to show
 * it as a result, and nothing else. Short-named, as a busy account holds a
 * hundred thousand of these, in memory and on disk.
 */
data class SearchDoc(
    val id: String,
    /** The channel. */
    val c: String,
    /** The author. */
    val a: String,
    /** When it was sent, in milliseconds. */
    val ts: Long,
    /** When it was last edited; a copy with a different one has changed. */
    val ed: Long?,
    /** The message as its author wrote it (markdown), or "". */
    val t: String,
    /** The message's flags; bit 1 is pinned. */
    val fl: Long,
    /** The people it mentions. */
    val mn: List<String>? = null,
    /** It mentions everyone. */
    val ev: Boolean = false,
    val att: List<AttachmentMeta>? = null,
    val emb: List<LinkPreview>? = null,
    val st: StickerRef? = null,
    /** A webhook's message: the name it was sent as. */
    val hn: String? = null,
    /** The words a message says beyond its text: a webhook's embeds and components, or a poll's question and answers. */
    val hx: String? = null,
)

/** One picture or clip a message carries: an uploaded file, or one it links to. */
sealed interface MediaItem {
    data class File(val att: AttachmentMeta) : MediaItem
    data class Link(val embed: LinkPreview) : MediaItem
}

/** A link a message carries, with its preview where it has one. */
data class LinkItem(val url: String, val preview: LinkPreview? = null)

object SearchDocs {
    const val PINNED = 1L

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }

    private fun num(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.doubleOrNull?.takeIf { it.isFinite() }

    /** A link card as the message carries it, held to what a result needs. */
    fun preview(e: JsonElement?): LinkPreview? {
        val r = e as? JsonObject ?: return null
        val url = str(r, "url") ?: return null
        return LinkPreview(
            url = url,
            type = str(r, "type"),
            title = str(r, "title"),
            site = str(r, "site_name"),
            description = str(r, "description")?.take(300),
            image = str(r, "image"),
            w = num(r, "image_w"),
            h = num(r, "image_h"),
            mime = str(r, "mime"),
        )
    }

    /** lib/poll.ts pollWords: the question and the answers, one a line. */
    fun pollWords(p: PollPayload): String = (listOf(p.question) + p.answers.map { it.text }).filter { Js.trim(it).isNotEmpty() }.joinToString("\n")

    /**
     * The index's copy of a decrypted message, or null for one that has
     * nothing to find: a line the app writes itself (a join, a call, a pin),
     * or a message this device cannot read.
     */
    fun toDoc(cm: fish.nexa.data.ChatMessage): SearchDoc? {
        val m = cm.m
        if (m.type.startsWith("system_")) return null
        val p = cm.payload ?: return null
        val hook = cm.hook?.let { fish.nexa.ui.markdown.Webhook.sanitize(it) }
        var att = p.att
        if (hook != null) att = fish.nexa.ui.markdown.Webhook.listedAttachments(hook).ifEmpty { null }
        // a webhook's payload carries its link previews already
        val emb = (p.embeds ?: emptyList()).mapNotNull { preview(it) }.ifEmpty { null }
        var hx = p.poll?.let { pollWords(it) }
        var hn: String? = null
        if (hook != null) {
            // a webhook is found by the name it was sent with; an app, by its bot, like anyone
            if (m.webhookId != null) hn = hook.name
            // the content is already t; what is left is the rest of what it says
            val rest = fish.nexa.ui.markdown.Webhook.text(hook.copy(content = ""))
            if (rest.isNotEmpty()) hx = rest.take(8000)
        }
        return SearchDoc(
            id = m.id, c = m.channelId, a = m.authorId, ts = m.createdAt, ed = m.editedAt, t = listOfNotNull(p.fwdComment, p.t).joinToString("\n"), fl = m.flags,
            mn = m.mentions.ifEmpty { null }, ev = m.mentionEveryone, att = att?.ifEmpty { null }, emb = emb, st = p.sticker, hn = hn, hx = hx,
        )
    }

    /**
     * Everything a search term can be found in: the message, and the names of
     * its files, its sticker and the pages it links to.
     */
    fun searchableText(d: SearchDoc): String {
        val extra = ArrayList<String>()
        d.hn?.let { extra += it }
        d.hx?.let { extra += it }
        d.att?.forEach { extra += it.name }
        d.st?.name?.takeIf { it.isNotEmpty() }?.let { extra += it }
        d.emb?.forEach { e ->
            e.title?.let { extra += it }
            e.site?.let { extra += it }
        }
        return if (extra.isNotEmpty()) d.t + "\n" + extra.joinToString("\n") else d.t
    }

    private const val URL_STOP = "<>()[]{}\"'`"

    /** The web addresses written in the message, each once, in order (`https?://[^\s<>()[\]{}"'`]+`, trailing punctuation off). */
    fun linksIn(text: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < text.length) {
            val at = schemeAt(text, i)
            if (at < 0) { i++; continue }
            var j = at
            while (j < text.length && !Js.isSpace(text[j]) && text[j] !in URL_STOP) j++
            if (j > at) {
                var url = text.substring(i, j)
                var k = url.length
                while (k > 0 && url[k - 1] in ".,;:!?*_~|") k--
                url = url.substring(0, k)
                if (url.length > 10 && url !in out) out += url
                i = j
            } else i++
        }
        return out
    }

    /** Where the address starts after `http://` or `https://` (any case) at `i`, or -1. */
    private fun schemeAt(s: String, i: Int): Int {
        fun at(k: Int, c: Char) = k < s.length && (s[k] == c || s[k] == c.uppercaseChar())
        if (!(at(i, 'h') && at(i + 1, 't') && at(i + 2, 't') && at(i + 3, 'p'))) return -1
        var k = i + 4
        if (at(k, 's')) k++
        if (k + 2 < s.length && s[k] == ':' && s[k + 1] == '/' && s[k + 2] == '/') return k + 3
        return -1
    }

    private val MEDIA_EMBEDS = setOf("image", "gif", "video")

    fun isImage(type: String) = type.lowercase().startsWith("image/")
    fun isVideo(type: String) = type.lowercase().startsWith("video/")

    /** The message's pictures and clips, uploaded ones first. */
    fun mediaOf(d: SearchDoc): List<MediaItem> {
        val out = ArrayList<MediaItem>()
        d.att?.forEach { if (isImage(it.type) || isVideo(it.type)) out += MediaItem.File(it) }
        d.emb?.forEach { if (it.type != null && it.type in MEDIA_EMBEDS) out += MediaItem.Link(it) }
        return out
    }

    /** The message's files that are not pictures or clips: documents, archives, audio. */
    fun filesOf(d: SearchDoc): List<AttachmentMeta> = d.att?.filter { !isImage(it.type) && !isVideo(it.type) } ?: emptyList()

    /**
     * The message's links: every address written in it, with the preview it
     * unfurled into, and previews of pages that are not pictures.
     */
    fun linksOf(d: SearchDoc): List<LinkItem> {
        val previews = HashMap<String, LinkPreview>()
        d.emb?.forEach { previews[it.url] = it }
        val out = ArrayList<LinkItem>()
        val seen = HashSet<String>()
        for (url in linksIn(d.t)) {
            val p = previews[url]
            if (p?.type != null && p.type in MEDIA_EMBEDS) continue
            seen += url
            out += LinkItem(url, p)
        }
        d.emb?.forEach { e ->
            if (e.url in seen || (e.type != null && e.type in MEDIA_EMBEDS)) return@forEach
            seen += e.url
            out += LinkItem(e.url, e)
        }
        return out
    }

    /** Which `has:` filters a message satisfies. */
    fun hasKinds(d: SearchDoc): Set<String> {
        val out = HashSet<String>()
        d.att?.forEach { a ->
            out += "file"
            when {
                isImage(a.type) -> out += "image"
                isVideo(a.type) -> out += "video"
                a.type.lowercase().startsWith("audio/") -> out += "audio"
            }
        }
        d.emb?.forEach { e ->
            out += "embed"
            if (e.type == "image" || e.type == "gif") out += "image"
            if (e.type == "video") out += "video"
        }
        if (d.st != null) out += "sticker"
        if (linksIn(d.t).isNotEmpty()) out += "link"
        return out
    }

    /** sameDoc: a copy with the same edit, flags, text and the same number of things carried has not changed. */
    fun same(a: SearchDoc, b: SearchDoc): Boolean = a.ed == b.ed && a.fl == b.fl && a.t == b.t && (a.att?.size ?: 0) == (b.att?.size ?: 0) &&
        (a.emb?.size ?: 0) == (b.emb?.size ?: 0) && (a.st != null) == (b.st != null) && (a.mn?.size ?: 0) == (b.mn?.size ?: 0)

    // ---- kept on disk as the web keeps it: short keys, JSON ----

    fun toJson(d: SearchDoc): JsonObject = buildJsonObject {
        put("id", d.id)
        put("c", d.c)
        put("a", d.a)
        put("ts", d.ts)
        put("ed", d.ed?.let { JsonPrimitive(it) } ?: JsonNull)
        put("t", d.t)
        put("fl", d.fl)
        d.mn?.let { put("mn", JsonArray(it.map(::JsonPrimitive))) }
        if (d.ev) put("ev", true)
        d.att?.let { list -> put("att", JsonArray(list.map { a -> attJson(a) })) }
        d.emb?.let { list -> put("emb", JsonArray(list.map(::previewJson))) }
        d.st?.let { s ->
            put("st", buildJsonObject {
                put("id", s.id)
                s.blob?.let { put("blob", it) }
                s.name?.let { put("name", it) }
                s.w?.let { put("w", it) }
                s.h?.let { put("h", it) }
                s.animated?.let { put("animated", it) }
                s.format?.let { put("format", it) }
            })
        }
        d.hn?.let { put("hn", it) }
        d.hx?.let { put("hx", it) }
    }

    /** An attachment as the message seals it, plus what a webhook's plain files carry. */
    private fun attJson(a: AttachmentMeta): JsonObject {
        val base = a.toJson()
        if (!a.plain && a.alt == null) return base
        return JsonObject(LinkedHashMap(base).apply {
            if (a.plain) put("plain", JsonPrimitive(true))
            a.alt?.let { put("alt", JsonPrimitive(it)) }
        })
    }

    private fun previewJson(p: LinkPreview): JsonObject = buildJsonObject {
        put("url", p.url)
        p.type?.let { put("type", it) }
        p.title?.let { put("title", it) }
        p.site?.let { put("site", it) }
        p.description?.let { put("description", it) }
        p.image?.let { put("image", it) }
        p.w?.let { put("w", it) }
        p.h?.let { put("h", it) }
        p.mime?.let { put("mime", it) }
    }

    private fun prim(o: JsonObject, k: String) = o[k] as? JsonPrimitive

    /** A doc read back from disk, or null for anything that does not look like one. */
    fun fromJson(e: JsonElement): SearchDoc? {
        val o = e as? JsonObject ?: return null
        val id = prim(o, "id")?.takeIf { it.isString }?.content ?: return null
        val c = prim(o, "c")?.takeIf { it.isString }?.content ?: return null
        val a = prim(o, "a")?.takeIf { it.isString }?.content ?: return null
        val ts = prim(o, "ts")?.takeIf { !it.isString }?.longOrNull ?: return null
        val t = prim(o, "t")?.takeIf { it.isString }?.content ?: return null
        val ed = prim(o, "ed")?.takeIf { !it.isString }?.longOrNull
        val fl = prim(o, "fl")?.takeIf { !it.isString }?.longOrNull ?: 0L
        val mn = (o["mn"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        val ev = prim(o, "ev")?.booleanOrNull ?: false
        val att = (o["att"] as? JsonArray)?.mapNotNull { x ->
            val meta = MessageCrypto.sanitizeAttachment(x) ?: return@mapNotNull null
            val xo = x as JsonObject
            val plain = (xo["plain"] as? JsonPrimitive)?.booleanOrNull ?: false
            val alt = (xo["alt"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (plain || alt != null) meta.copy(plain = plain, alt = alt) else meta
        }
        val emb = (o["emb"] as? JsonArray)?.mapNotNull { x ->
            val p = x as? JsonObject ?: return@mapNotNull null
            val url = str(p, "url") ?: return@mapNotNull null
            LinkPreview(url, str(p, "type"), str(p, "title"), str(p, "site"), str(p, "description"), str(p, "image"), num(p, "w"), num(p, "h"), str(p, "mime"))
        }
        val st = (o["st"] as? JsonObject)?.let { s ->
            val sid = str(s, "id") ?: return@let null
            StickerRef(sid, str(s, "blob"), str(s, "name"), num(s, "w"), num(s, "h"), (s["animated"] as? JsonPrimitive)?.booleanOrNull, str(s, "format"))
        }
        val hn = prim(o, "hn")?.takeIf { it.isString }?.content
        val hx = prim(o, "hx")?.takeIf { it.isString }?.content
        return SearchDoc(id, c, a, ts, ed, t, fl, mn?.ifEmpty { null }, ev, att?.ifEmpty { null }, emb?.ifEmpty { null }, st, hn, hx)
    }
}
