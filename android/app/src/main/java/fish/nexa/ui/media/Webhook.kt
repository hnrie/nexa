package fish.nexa.ui.media

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.data.HookComponent
import fish.nexa.data.HookContent
import fish.nexa.data.HookEmbed
import fish.nexa.data.HookEmoji
import fish.nexa.data.HookMedia
import fish.nexa.data.Hooks
import fish.nexa.media.Fit
import fish.nexa.media.Media
import fish.nexa.media.Priority
import fish.nexa.media.loadAttachment
import fish.nexa.media.mediaSrc
import fish.nexa.media.openExternal
import fish.nexa.media.TwemojiImage
import fish.nexa.net.Message
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.chat.ListCtx
import fish.nexa.ui.chat.PollShape
import fish.nexa.ui.chat.PollView
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import java.net.URI

/**
 * HookBody.tsx: what a webhook posted under its words and files: its rich
 * embeds, its own link previews, its components and its poll. Embeds go when
 * the message's embeds were removed; a "components v2" message is drawn by its
 * components alone.
 */
@Composable
fun HookBody(cm: ChatMessage, ctx: ListCtx) {
    val hook = Hooks.of(cm.hook) ?: return
    val suppressed = cm.m.suppressEmbeds
    val v2 = cm.m.flags and Message.MSG_FLAG_COMPONENTS_V2 != 0L
    val from = senderName(cm, ctx)
    if (!suppressed && !v2) RichEmbeds(hook, from)
    if (!suppressed && !v2 && hook.linkEmbeds.isNotEmpty()) Embeds(hook.linkEmbeds, cm, ctx)
    if (hook.components.isNotEmpty()) {
        Column(Modifier.padding(top = 4.dp).widthIn(max = 520.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (c in hook.components) HookPart(c, hook, from)
        }
    }
    if (hook.poll != null && !v2) {
        val shape = remember(hook.poll) { PollShape.of(hook.poll) }
        PollView(shape, cm.m.pollResults, cm.channelId, cm.id)
    }
}

/** A webhook picture: its own upload (fetched with the token) or a proxied address; null never shows, "" is on its way. */
@Composable
private fun hookSrc(hook: HookContent, blobId: String?, proxy: String?): Any? {
    if (blobId != null) {
        val att = Hooks.mediaAttachment(hook, HookMedia(url = "", blobId = blobId)) ?: return null
        var file by remember(blobId) { mutableStateOf(Media.cached(blobId, true)) }
        LaunchedEffect(blobId) {
            if (file == null) file = runCatching { loadAttachment(att, Priority.NEAR) }.getOrNull()
        }
        return file ?: ""
    }
    return mediaSrc(proxy)
}

private fun nameOf(url: String): String = runCatching { URI(url).path.split('/').lastOrNull { it.isNotEmpty() } }.getOrNull() ?: "image"

private fun lightboxItem(hook: HookContent, m: HookMedia): LightboxItem {
    val att = Hooks.mediaAttachment(hook, m)
    if (att != null) return LightboxItem(att.name, att.type, att = att)
    return LightboxItem(nameOf(m.url), src = fish.nexa.media.MediaLinks.src(m.proxyUrl)?.takeIf { it.isNotEmpty() } ?: m.proxyUrl)
}

/** mergeGalleries: embeds sharing a URL show as one, their pictures as its gallery of up to four. */
private data class Shown(val embed: HookEmbed, val images: MutableList<HookMedia>)

private fun mergeGalleries(embeds: List<HookEmbed>): List<Shown> {
    val out = ArrayList<Shown>()
    val byUrl = HashMap<String, Shown>()
    for (e in embeds) {
        val first = e.url?.let { byUrl[it] }
        if (first != null) {
            if (e.image != null && first.images.size < 4) first.images += e.image
            continue
        }
        val s = Shown(e, listOfNotNull(e.image).toMutableList())
        if (e.url != null) byUrl[e.url] = s
        out += s
    }
    return out
}

/** fieldRows: inline fields three to a row (two beside a thumbnail), others full width, as fractions of the row. */
private fun fieldRows(fields: List<fish.nexa.data.HookEmbedField>, thumbnail: Boolean): List<List<fish.nexa.data.HookEmbedField>> {
    val per = if (thumbnail) 2 else 3
    val out = ArrayList<List<fish.nexa.data.HookEmbedField>>()
    var run = ArrayList<fish.nexa.data.HookEmbedField>()
    for (f in fields) {
        if (!f.inline) {
            if (run.isNotEmpty()) { out += run; run = ArrayList() }
            out += listOf(f)
            continue
        }
        run += f
        if (run.size == per) { out += run; run = ArrayList() }
    }
    if (run.isNotEmpty()) out += run
    return out
}

@Composable
private fun RichEmbeds(hook: HookContent, from: String) {
    val shown = remember(hook) { mergeGalleries(hook.embeds) }
    if (shown.isEmpty()) return
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (s in shown) if (s.embed.type != "poll_result") RichEmbed(hook, s.embed, s.images, from)
    }
}

/** RichEmbed: a lit card with the embed's colour down its start: author, title, words, fields, pictures, footer. */
@Composable
private fun RichEmbed(hook: HookContent, embed: HookEmbed, all: List<HookMedia>, from: String) {
    val c = Nx.colors
    val doc by Nexa.settings.doc.collectAsState()
    val remoteOk = remember(doc) { Nexa.settings.imagePreviews }
    val images = if (remoteOk) all else all.filter { it.blobId != null }
    val thumbnail = embed.thumbnail?.takeIf { remoteOk || it.blobId != null }
    val rows = remember(embed, thumbnail != null) { fieldRows(embed.fields, thumbnail != null) }
    val viewer = (images + listOfNotNull(thumbnail)).map { lightboxItem(hook, it).copy(from = from) }
    val shape = Radii.Md
    Box(
        Modifier
            .widthIn(max = 520.dp)
            .shadowLow(shape, c)
            .ring(shape, c.borderSubtle)
            .clip(shape)
            .background(c.embedBg)
            .background(sheen(c))
            .topEdge(shape, c.edgeLight)
            .startBar(embed.color?.let { rgbColor(it) } ?: c.borderStrong),
    ) {
        // as wide as its widest part (up to the card's limit), like the web's shrink-to-fit grid
        Column(Modifier.width(IntrinsicSize.Max).padding(start = 12.dp, end = 16.dp, top = 2.dp, bottom = 16.dp)) {
            // the thumbnail sits at the top end beside the words; the picture and the footer run the full width below
            val head = embed.author != null || embed.title != null || embed.description != null || rows.isNotEmpty()
            if (head || thumbnail != null) Row(Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    embed.author?.let { a ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val icon = hookSrc(hook, a.iconBlobId, a.proxyIconUrl)
                            if (icon != null && icon != "") AsyncImage(icon, null, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.size(24.dp).clip(CircleShape))
                            Txt(
                                a.name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textStrong,
                                modifier = if (a.url != null) Modifier.pressable(remember { MutableInteractionSource() }) { openExternal(a.url) } else Modifier,
                            )
                        }
                    }
                    embed.title?.let { title ->
                        Box(if (embed.url != null) Modifier.pressable(remember { MutableInteractionSource() }) { openExternal(embed.url) } else Modifier) {
                            fish.nexa.ui.markdown.MarkdownView(title, fish.nexa.ui.markdown.RenderCtx(color = if (embed.url != null) c.link else c.textStrong))
                        }
                    }
                    embed.description?.let { fish.nexa.ui.markdown.MarkdownView(it, fish.nexa.ui.markdown.RenderCtx(color = c.text)) }
                    for (row in rows) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (f in row) Column(Modifier.weight(1f)) {
                            Txt(f.name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textStrong)
                            fish.nexa.ui.markdown.MarkdownView(f.value, fish.nexa.ui.markdown.RenderCtx(color = c.text))
                        }
                    }
                }
                if (thumbnail != null) Box(Modifier.padding(start = 16.dp, top = 8.dp)) {
                    EmbedImage(hook, thumbnail, thumb = true) { openLightbox(viewer, images.size) }
                }
            }
            if (images.size == 1) EmbedImage(hook, images[0], thumb = false) { openLightbox(viewer, 0) }
            else if (images.size > 1) EmbedGallery(hook, images) { i -> openLightbox(viewer, i) }
            if (embed.footer != null || embed.timestamp != null) {
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val icon = hookSrc(hook, embed.footer?.iconBlobId, embed.footer?.proxyIconUrl)
                    if (icon != null && icon != "") AsyncImage(icon, null, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.size(20.dp).clip(CircleShape))
                    val parts = listOfNotNull(embed.footer?.text, embed.timestamp?.let { Time.timestamp(it) })
                    Txt(parts.joinToString(" • "), style = Nx.type.hint.copy(lineHeight = Nx.type.sp(16f), fontWeight = FontWeight(500)), color = c.textMuted)
                }
            }
        }
    }
}

@Composable
private fun EmbedImage(hook: HookContent, m: HookMedia, thumb: Boolean, onOpen: () -> Unit) {
    val c = Nx.colors
    val src = hookSrc(hook, m.blobId, m.proxyUrl) ?: return
    // a thumbnail is held within 64 dp on a phone (80 on the web), a picture within 400 by 300, both kept whole
    val box = if (thumb) Fit.within(m.width, m.height, 64, 64) else Fit.within(m.width, m.height, 400, 300)
    val fallback = if (thumb) 64.dp else 80.dp
    Box(
        Modifier
            .padding(top = if (thumb) 0.dp else 16.dp)
            .then(if (box != null) Modifier.width(box.width.dp).aspectRatio(box.width.toFloat() / box.height) else Modifier.size(fallback))
            .clip(Radii.Xs)
            .background(c.bgInput)
            .pressable(remember { MutableInteractionSource() }, onClick = onOpen)
            .semantics { contentDescription = m.description ?: t("webhook.openImage") },
    ) {
        if (src != "") AsyncImage(src, m.description, imageLoader = Media.loader, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
    }
}

/** Up to four pictures of embeds sharing a URL: two columns of squares, the first spanning two rows when there are three. */
@Composable
private fun EmbedGallery(hook: HookContent, images: List<HookMedia>, onOpen: (Int) -> Unit) {
    val c = Nx.colors
    @Composable
    fun cell(i: Int, modifier: Modifier) {
        val src = hookSrc(hook, images[i].blobId, images[i].proxyUrl)
        Box(modifier.clipToBounds().background(c.bgInput).pressable(remember { MutableInteractionSource() }) { onOpen(i) }) {
            if (src != null && src != "") AsyncImage(src, images[i].description, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
    val gap = 4.dp
    Column(Modifier.padding(top = 16.dp).width(400.dp).clip(Radii.Xs), verticalArrangement = Arrangement.spacedBy(gap)) {
        if (images.size == 3) Row(Modifier.fillMaxWidth().aspectRatio(1f), horizontalArrangement = Arrangement.spacedBy(gap)) {
            cell(0, Modifier.weight(1f).fillMaxHeight())
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                cell(1, Modifier.weight(1f).fillMaxWidth()); cell(2, Modifier.weight(1f).fillMaxWidth())
            }
        } else for (r in images.indices step 2) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
            cell(r, Modifier.weight(1f).aspectRatio(1f))
            if (r + 1 < images.size) cell(r + 1, Modifier.weight(1f).aspectRatio(1f)) else Box(Modifier.weight(1f))
        }
    }
}

/** HookComponents: one component of a webhook's message, as its type says. */
@Composable
private fun HookPart(c: HookComponent, hook: HookContent, from: String) {
    when (c.type) {
        Hooks.C_ACTION_ROW -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (b in c.components) if (b.type == Hooks.C_BUTTON) LinkButton(b)
        }
        Hooks.C_BUTTON -> LinkButton(c)
        Hooks.C_TEXT -> c.content?.let { fish.nexa.ui.markdown.MarkdownView(it, fish.nexa.ui.markdown.RenderCtx(color = Nx.colors.text)) }
        Hooks.C_SECTION -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { for (x in c.components) HookPart(x, hook, from) }
            c.accessory?.let { acc ->
                if (acc.type == Hooks.C_THUMBNAIL && acc.media != null) Thumbnail(hook, acc)
                else if (acc.type == Hooks.C_BUTTON) LinkButton(acc)
            }
        }
        Hooks.C_THUMBNAIL -> if (c.media != null) Thumbnail(hook, c)
        Hooks.C_GALLERY -> if (c.items.isNotEmpty()) Gallery(hook, c, from)
        Hooks.C_FILE -> c.file?.let { f -> Hooks.mediaAttachment(hook, f) }?.let { att ->
            Attachments(listOf(if (c.spoiler) att.copy(spoiler = true) else att), null, null)
        }
        Hooks.C_SEPARATOR -> {
            val space = if (c.spacing == 2) 12.dp else 4.dp
            Box(Modifier.fillMaxWidth().padding(vertical = space).height(1.dp).background(if (c.divider != false) Nx.colors.border else Color.Transparent))
        }
        Hooks.C_CONTAINER -> Container(c, hook, from)
    }
}

@Composable
private fun Container(c: HookComponent, hook: HookContent, from: String) {
    val colors = Nx.colors
    var revealed by remember(c) { mutableStateOf(false) }
    val hidden = c.spoiler && !revealed
    Box(
        Modifier
            .fillMaxWidth()
            .border(1.dp, colors.borderSubtle, Radii.Sm)
            .clip(Radii.Sm)
            .background(colors.embedBg)
            .then(c.accentColor?.let { Modifier.startBar(rgbColor(it)) } ?: Modifier),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp).then(if (hidden && canBlur) Modifier.blur(24.dp) else Modifier),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (!hidden || canBlur) for (x in c.components) HookPart(x, hook, from)
            else Box(Modifier.fillMaxWidth().height(64.dp))
        }
        if (hidden) SpoilerCover(13f) { revealed = true }
    }
}

@Composable
private fun HookEmojiGlyph(e: HookEmoji, size: Int) {
    val density = LocalDensity.current.density
    if (e.id != null) AsyncImage(Media.emojiUrl(e.id, size, density), e.name?.let { ":$it:" }, imageLoader = Media.loader, modifier = Modifier.size(size.dp))
    else if (e.name != null) TwemojiImage(e.name, size.dp)
}

/** A webhook's link button: its emoji and label and the open-elsewhere mark; it opens the address in the browser. */
@Composable
private fun LinkButton(b: HookComponent) {
    val c = Nx.colors
    if (b.style != Hooks.BUTTON_LINK || b.url == null) return
    val host = runCatching { URI(b.url).host }.getOrNull() ?: b.url
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .heightIn(min = 32.dp)
            .widthIn(min = 60.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgActive else c.bgSurface)
            .pressable(interaction, enabled = !b.disabled) { openExternal(b.url) }
            .semantics { contentDescription = if (b.label != null) t("webhook.linkButton", "label" to b.label, "host" to host) else host }
            .padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        b.emoji?.let { HookEmojiGlyph(it, 18) }
        b.label?.let { Txt(it, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(500)), color = c.textStrong.copy(alpha = if (b.disabled) 0.5f else 1f), maxLines = 1) }
        Icon("ExternalLink", c.textStrong.copy(alpha = if (b.disabled) 0.5f else 1f), size = 14.dp)
    }
}

/** A section's or a message's single picture: 85 dp square, covered when a spoiler. */
@Composable
private fun Thumbnail(hook: HookContent, c: HookComponent) {
    val colors = Nx.colors
    val media = c.media ?: return
    val doc by Nexa.settings.doc.collectAsState()
    val remoteOk = remember(doc) { Nexa.settings.imagePreviews }
    if (!remoteOk && media.blobId == null) return
    val src = hookSrc(hook, media.blobId, media.proxyUrl) ?: return
    var revealed by remember(c) { mutableStateOf(false) }
    val spoiler = c.spoiler && !revealed
    Box(
        Modifier
            .size(85.dp)
            .clip(Radii.Sm)
            .background(colors.bgInput)
            .pressable(remember { MutableInteractionSource() }) { if (spoiler) revealed = true else openLightbox(listOf(lightboxItem(hook, media)), 0) }
            .semantics { contentDescription = if (spoiler) t("render.spoilerHidden") else c.description ?: t("webhook.openImage") },
    ) {
        if (src != "" && (!spoiler || canBlur)) AsyncImage(src, c.description, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().then(if (spoiler) Modifier.spoilerBlur() else Modifier))
        if (spoiler) HookSpoilerLabel(Modifier.align(Alignment.Center))
    }
}

/** The small "Spoiler" pill webhook pictures wear (letter-spaced, as the web's). */
@Composable
private fun HookSpoilerLabel(modifier: Modifier) {
    Box(modifier.background(Color(0x99000000), RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Txt(t("composer.composer.spoiler"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(700), letterSpacing = 0.04.em), color = Color.White)
    }
}

/** A media gallery: one contained up to 350 dp, two or four in two columns, three as two and one, more in threes; videos play in place. */
@Composable
private fun Gallery(hook: HookContent, all: HookComponent, from: String) {
    val colors = Nx.colors
    val doc by Nexa.settings.doc.collectAsState()
    val remoteOk = remember(doc) { Nexa.settings.imagePreviews }
    val items = if (remoteOk) all.items else all.items.filter { it.media.blobId != null }
    val revealed = remember(all) { mutableStateMapOf<Int, Boolean>() }
    if (items.isEmpty()) return
    fun isVideo(m: HookMedia) = (m.contentType ?: "").startsWith("video/")
    val pictures = items.withIndex().filter { (i, it) -> !isVideo(it.media) && (!it.spoiler || revealed[i] == true) }
    val viewer = pictures.map { (_, it) -> lightboxItem(hook, it.media).copy(from = from) }
    @Composable
    fun cell(i: Int, modifier: Modifier) {
        val it = items[i]
        val spoiler = it.spoiler && revealed[i] != true
        val src = hookSrc(hook, it.media.blobId, it.media.proxyUrl) ?: return
        if (isVideo(it.media) && src != "" && !spoiler) {
            Box(modifier) {
                val att = Hooks.mediaAttachment(hook, it.media)
                if (att != null) VideoPlayer(VideoSource.Attachment(att), att.name, att.w, att.h, eager = false)
                else if (src is String) VideoPlayer(VideoSource.Url(src), nameOf(it.media.url), it.media.width, it.media.height, eager = false)
            }
            return
        }
        Box(
            modifier
                .clipToBounds()
                .background(colors.bgInput)
                .pressable(remember { MutableInteractionSource() }) {
                    if (spoiler) revealed[i] = true
                    else openLightbox(viewer, pictures.indexOfFirst { p -> p.index == i }.coerceAtLeast(0))
                }
                .semantics { contentDescription = if (spoiler) t("render.spoilerHidden") else it.description ?: t("webhook.openImage") },
        ) {
            if (src != "" && (!spoiler || canBlur)) AsyncImage(src, it.description, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().then(if (spoiler) Modifier.spoilerBlur() else Modifier))
            if (spoiler) HookSpoilerLabel(Modifier.align(Alignment.Center))
        }
    }
    val gap = 4.dp
    val n = items.size
    Column(Modifier.widthIn(max = 520.dp).fillMaxWidth().clip(Radii.Sm), verticalArrangement = Arrangement.spacedBy(gap)) {
        when {
            n == 1 -> cell(0, Modifier.fillMaxWidth().heightIn(max = 350.dp).aspectRatio(
                items[0].media.let { m -> if (m.width != null && m.height != null) (m.width / m.height).toFloat().coerceIn(0.5f, 3f) else 16f / 9f },
            ))
            n == 3 -> Row(Modifier.fillMaxWidth().aspectRatio(1.5f), horizontalArrangement = Arrangement.spacedBy(gap)) {
                cell(0, Modifier.weight(2f).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    cell(1, Modifier.weight(1f).fillMaxWidth()); cell(2, Modifier.weight(1f).fillMaxWidth())
                }
            }
            else -> {
                val cols = if (n == 2 || n == 4) 2 else 3
                for (r in 0 until n step cols) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    for (k in 0 until cols) if (r + k < n) cell(r + k, Modifier.weight(1f).aspectRatio(1f)) else Box(Modifier.weight(1f))
                }
            }
        }
    }
}
