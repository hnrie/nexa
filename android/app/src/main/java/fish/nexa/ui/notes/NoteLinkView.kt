package fish.nexa.ui.notes

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.NoteCrypto
import fish.nexa.media.Media
import fish.nexa.media.rememberAttachmentLoad
import fish.nexa.notes.NoteLinks
import fish.nexa.notes.NoteModel
import fish.nexa.notes.NoteRole
import fish.nexa.notes.NoteShare
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.markdown.AppLinks
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.media.copyOf
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch

private val KEY = Regex("^[A-Za-z0-9_-]{43}$")
private val TOKEN = Regex("^[A-Za-z0-9_-]{16,128}$")

/** The two halves of a share link, from its token and the fragment it came with; null when the key is missing. */
fun linkSecret(token: String, hash: String): NoteCrypto.LinkSecret? {
    val key = hash.removePrefix("#")
    return if (TOKEN.matches(token) && KEY.matches(key)) NoteCrypto.LinkSecret(token, key) else null
}

enum class LinkVariant { CARD, DIALOG }

/** A note's share link, opened inside the app (NoteLinkDialog.tsx): what it leads to, and joining it. */
fun openNoteLink(token: String, hash: String) {
    val secret = linkSecret(token, hash)
    lateinit var layer: Layer
    layer = Layer("note-link") { close ->
        Sheet(layer, maxWidth = 460.dp, closeButton = false, padding = 0.dp) {
            NoteLinkView(secret, LinkVariant.DIALOG, onDone = close)
        }
    }
    Layers.open(layer)
}

/**
 * A card under a message for each note share link it has (NoteCards.tsx).
 * The card is made here, on each device that shows the message: what the
 * link leads to can only be read with the key in the link.
 */
@Composable
fun NoteCards(text: String?) {
    val links = remember(text) { if (text.isNullOrEmpty()) emptyList() else AppLinks.noteLinksIn(Markdown.parse(text), Nexa.api.baseUrl) }
    if (links.isEmpty()) return
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (l in links) androidx.compose.runtime.key(l.token) { NoteLinkView(linkSecret(l.token, l.hash), LinkVariant.CARD) }
    }
}

/**
 * What a note's share link leads to (NoteLinkView.tsx): the note's title and
 * first lines, who shares it and with how many, what joining lets you do,
 * and the button to join it or open it. Drawn as a card in a message, and in
 * the sheet a link opens.
 */
@Composable
fun NoteLinkView(secret: NoteCrypto.LinkSecret?, variant: LinkVariant, onDone: (() -> Unit)? = null) {
    val c = Nx.colors
    val card = variant == LinkVariant.CARD
    val entries by NoteLinks.byLink.collectAsState()
    val entry = secret?.let { entries[NoteLinks.keyOf(it)] }
    val scope = rememberCoroutineScope()
    LaunchedEffect(secret) { secret?.let { NoteLinks.load(it) } }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    if (secret == null || entry is NoteLinks.Entry.Locked) {
        Gone(variant, t("notes.link.noKeyTitle"), t("notes.link.noKeyBody"), icon = "KeyRound")
        return
    }
    if (entry is NoteLinks.Entry.Invalid) {
        Gone(variant, t("notes.link.goneTitle"), t("notes.link.goneBody"))
        return
    }
    if (entry is NoteLinks.Entry.Failed) {
        Gone(variant, t("notes.link.failedTitle"), t("notes.link.failedBody")) {
            NxButton(t("notes.link.tryAgain"), { scope.launch { NoteLinks.load(secret, force = true) } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "RotateCw")
        }
        return
    }
    val opened = (entry as? NoteLinks.Entry.Ready)?.opened
    if (opened == null) {
        Frame(variant, Modifier.semantics { contentDescription = t("notes.link.opening") }) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Icon("NotebookPen", c.textMuted, size = if (card) 20.dp else 26.dp, modifier = Modifier.padding(top = 2.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SkeletonLine(0.7f)
                    SkeletonLine(0.4f)
                }
            }
        }
        return
    }

    val view = opened.view
    val head = opened.head
    val member = view.memberRole > 0
    val owner = view.owner?.let { it.displayName.ifEmpty { it.username } }
    fun open() {
        onDone?.invoke()
        Nav.go(Route.Notes(view.noteId))
    }
    fun join() {
        busy = true
        error = null
        scope.launch {
            try {
                val it = NoteShare.joinLink(secret, opened)
                onDone?.invoke()
                Nav.go(Route.Notes(it.id))
            } catch (e: Exception) {
                val said = NoteShare.error(e, t("notes.link.couldNotJoin"))
                if (card) Nexa.ui.toast(said, "error") else error = said
            } finally {
                busy = false
            }
        }
    }
    val button: @Composable () -> Unit = {
        if (member) NxButton(t("notes.link.open"), ::open, kind = ButtonKind.SECONDARY, size = if (card) ButtonSize.SM else ButtonSize.LG, block = !card)
        else NxButton(t("notes.link.join"), ::join, kind = ButtonKind.POSITIVE, size = if (card) ButtonSize.SM else ButtonSize.LG, block = !card, loading = busy)
    }
    // A note's files can be fetched only by the people in it: anyone else is shown their names.
    val files = if (member) head.files else null
    val title = NoteModel.name(head.title)
    Frame(variant, Modifier.semantics(mergeDescendants = false) { contentDescription = t("notes.link.label", "title" to title) }) {
        // the card's button sits at the end of its top line, the title taking what room is left
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon("NotebookPen", c.textMuted, size = if (card) 20.dp else 26.dp, modifier = Modifier.padding(top = 2.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt(
                    if (owner != null) t("notes.link.sharedBy", "name" to owner) else t("notes.link.shared"),
                    style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17.55f)),
                    color = c.textMuted,
                )
                Txt(
                    title,
                    style = if (card) Nx.type.name.copy(fontSize = Nx.type.sp(17f), lineHeight = Nx.type.sp(21.25f), fontWeight = FontWeight(700), letterSpacing = (-0.01).em)
                    else Nx.type.title.copy(fontSize = Nx.type.sp(26f), lineHeight = Nx.type.sp(29.9f), fontWeight = FontWeight(740), letterSpacing = (-0.02).em),
                    color = if (head.title.isBlank()) c.textMuted else c.textStrong,
                )
            }
            if (card) button()
        }
        if (head.preview.isNotBlank()) Preview(head.preview, files, card)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon("Users", c.textMuted, size = 14.dp)
                Txt(t("notes.link.people", "count" to view.members), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
            }
            Box(Modifier.height(26.dp).background(c.bgActive, RoundedCornerShape(50)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                Txt(
                    when {
                        member -> t("notes.link.alreadyIn")
                        view.role == NoteRole.EDITOR -> t("notes.link.joinToEdit")
                        else -> t("notes.link.joinToView")
                    },
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(600)),
                    color = c.textSubtle,
                    maxLines = 1,
                )
            }
        }
        if (!card) Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            button()
            error?.let { Txt(it, style = Nx.type.bodySmall, color = c.textDanger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
        }
    }
}

/** The link's frame (.linkView): a slip in a message, or the sheet a link opens. */
@Composable
private fun Frame(variant: LinkVariant, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = Nx.colors
    if (variant == LinkVariant.CARD) {
        val shape = Radii.Lg
        Column(
            modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .shadowMedium(shape, c)
                .ring(shape, c.borderSubtle)
                .background(c.embedBg, shape)
                .background(sheen(c), shape)
                .topEdge(shape, c.edgeLight)
                .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) { content() }
    } else {
        Column(modifier.fillMaxWidth().padding(start = 26.dp, end = 26.dp, top = 8.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
    }
}

/** A link that leads nowhere it can show (no key, removed, could not load), and what to do. */
@Composable
private fun Gone(variant: LinkVariant, title: String, body: String, icon: String = "NotebookPen", action: (@Composable () -> Unit)? = null) {
    val c = Nx.colors
    Frame(variant, Modifier.semantics(mergeDescendants = true) { contentDescription = title }) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, c.textMuted, size = if (variant == LinkVariant.CARD) 20.dp else 26.dp, modifier = Modifier.padding(top = 2.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt(title, style = Nx.type.name.copy(fontSize = Nx.type.sp(17f), fontWeight = FontWeight(700), letterSpacing = (-0.01).em), color = c.textStrong)
                Txt(body, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17.55f)), color = c.textMuted)
            }
        }
        action?.invoke()
    }
}

/** A line of the card still on its way (.skeletonLine), breathing. */
@Composable
private fun SkeletonLine(width: Float) {
    val reduced = Nx.motion.reduced
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "breathe")
    Box(Modifier.fillMaxWidth(width).height(12.dp).alpha(if (reduced) 1f else a).background(Nx.colors.bgActive, RoundedCornerShape(6.dp)))
}

/**
 * The note's first lines (NotePreview), drawn as the note is but as a
 * picture of it: nothing in it takes a tap of its own, and it fades out at
 * the foot.
 */
@Composable
private fun Preview(preview: String, files: Map<String, AttachmentMeta>?, card: Boolean) {
    val subtle = Nx.colors.textSubtle
    val ctx = remember(files, card, subtle) {
        RenderCtx(
            inert = true,
            files = true,
            max = NoteModel.PREVIEW_CHARS,
            bodyPx = if (card) 14f else 15f,
            bodyLine = if (card) 21f else 22.5f,
            color = subtle,
            renderFile = { id, name, _, _ -> NoteFileThumb(files?.get(id), name) },
        )
    }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(max = if (card) 92.dp else 168.dp)
            .clipToBounds()
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                drawRect(Brush.verticalGradient(0f to Color.Black, 0.5f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
            }
            .clearAndSetSemantics {},
    ) { MarkdownView(preview, ctx) }
}

/** A picture this big with no small copy beside it is not fetched for a card: the card names it instead. */
private const val THUMB_MAX = 8L * 1024 * 1024

/** A file as a note's preview shows it (NoteFileThumb): a picture as a small crop of itself, anything else by its name. */
@Composable
fun NoteFileThumb(meta: AttachmentMeta?, name: String) {
    val c = Nx.colors
    val shown = if (meta != null && meta.isImage) copyOf(meta) ?: meta.takeIf { it.size <= THUMB_MAX } else null
    if (shown == null) {
        Row(
            Modifier.padding(vertical = 2.dp).background(c.bgActive, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon("File", c.text, size = 14.dp)
            Txt(name, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.text, maxLines = 1)
        }
        return
    }
    val load = rememberAttachmentLoad(shown, true)
    Box(Modifier.padding(vertical = 4.dp).widthIn(max = 220.dp).fillMaxWidth().height(84.dp).clip(Radii.Sm).background(c.bgActive)) {
        load.file?.let { AsyncImage(it, meta?.alt ?: name, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
    }
}
