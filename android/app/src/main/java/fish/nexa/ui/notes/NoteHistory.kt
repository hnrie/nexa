package fish.nexa.ui.notes

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import fish.nexa.Nexa
import fish.nexa.notes.NoteDoc
import fish.nexa.notes.NoteHistoryData
import fish.nexa.notes.NoteModel
import fish.nexa.notes.NoteShare
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.server.Loading
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch

private const val NOW = "now"

private sealed interface Shown {
    val id: String

    class Doc(override val id: String, val doc: NoteDoc) : Shown
    class Failed(override val id: String, val error: Throwable) : Shown
}

/**
 * A note's earlier versions, in place of the note (NoteHistory.tsx): on a
 * phone, every version, newest first, by when it was saved and by whom; the
 * one picked, read as it was, in its place. Whoever may edit the note puts
 * one back from there; what it replaces is kept as a version of its own.
 */
@Composable
fun NoteHistoryView(noteId: String, current: () -> NoteDoc, canRestore: Boolean, narrow: Boolean, onClose: () -> Unit, onRestore: suspend (NoteDoc) -> Boolean) {
    val c = Nx.colors
    val users by Nexa.users.byId.collectAsState()
    val scope = rememberCoroutineScope()
    var history by remember { mutableStateOf<NoteHistoryData?>(null) }
    var failed by remember { mutableStateOf<Throwable?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var picked by remember { mutableStateOf(if (narrow) null else NOW) }
    var shown by remember { mutableStateOf<Shown?>(null) }
    var busy by remember { mutableStateOf(false) }
    val now = remember { current() }

    LaunchedEffect(noteId, attempt) {
        failed = null
        try {
            val h = NoteHistoryData.load(noteId)
            history = h
            val missing = h.versions.mapNotNull { it.editedBy }.distinct().filter { Nexa.users.get(it) == null }
            if (missing.isNotEmpty()) Nexa.session.ensureUsers(missing)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = e
        }
    }
    LaunchedEffect(picked, history) {
        val p = picked ?: return@LaunchedEffect
        if (p == NOW) {
            shown = Shown.Doc(NOW, now)
            return@LaunchedEffect
        }
        val h = history ?: return@LaunchedEffect
        shown = null
        shown = try {
            Shown.Doc(p, h.open(p))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Shown.Failed(p, e)
        }
    }

    val version = history?.versions?.firstOrNull { it.id == picked }
    fun who(v: NoteHistoryData.Version): String = v.editedBy?.let { id -> users[id]?.let { it.displayName.ifEmpty { it.username } } } ?: t("names.unknownUser")
    val s = shown
    val canPutBack = canRestore && s is Shown.Doc && s.id != NOW
    fun restore() {
        val doc = (shown as? Shown.Doc)?.takeIf { it.id != NOW }?.doc ?: return
        busy = true
        scope.launch {
            try {
                if (onRestore(doc)) onClose() else Nexa.ui.toast(t("notes.history.couldNotRestore"), "error")
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.history.couldNotRestore")), "error")
            } finally {
                busy = false
            }
        }
    }
    val back = if (narrow && picked != null) ({ picked = null }) else onClose
    BackHandler(enabled = fish.nexa.ui.layers.Layers.isEmpty) { back() }

    val rail: @Composable (Modifier) -> Unit = { modifier ->
        LazyColumn(modifier.semantics { contentDescription = t("notes.history.title") }, contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 24.dp)) {
            item("now") {
                VersionButton(picked == NOW, { picked = NOW }) {
                    Txt(t("notes.history.current"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(700), fontFeatureSettings = "tnum"), color = c.textStrong)
                    Txt(NoteModel.name(now.title), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
                }
            }
            val h = history
            if (h == null && failed == null) item("loading") { Loading(t("notes.history.loading")) }
            failed?.let { err ->
                item("failed") {
                    Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Txt(NoteShare.error(err, t("notes.history.couldNotLoad")), style = Nx.type.bodySmall, color = c.textMuted)
                        NxButton(t("notes.page.tryAgain"), { attempt += 1 }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                    }
                }
            }
            if (h != null && h.versions.isEmpty()) item("none") {
                Txt(t("notes.history.none"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19.6f)), color = c.textMuted, modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
            }
            if (h != null) itemsIndexed(h.versions, key = { _, v -> v.id }) { i, v ->
                val before = h.versions.getOrNull(i - 1)
                Column {
                    if (before == null || !Time.sameDay(before.savedAt, v.savedAt)) {
                        Txt(
                            Time.dateDivider(v.savedAt),
                            style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700)),
                            color = c.textMuted,
                            modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 14.dp, bottom = 4.dp).semantics { heading() },
                        )
                    }
                    VersionButton(picked == v.id, { picked = v.id }) {
                        Txt(Time.time(v.savedAt), style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(700), fontFeatureSettings = "tnum"), color = c.textStrong)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            v.editedBy?.let { id -> Avatar(id, who(v), users[id]?.avatarId, 18.dp) }
                            fish.nexa.ui.chat.PersonName(v.editedBy, who(v), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textSubtle, maxLines = 1)
                        }
                        when {
                            v.head == null -> Txt(t("notes.history.unreadable"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
                            v.head.title != now.title -> Txt(NoteModel.name(v.head.title), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
                        }
                    }
                }
            }
        }
    }

    val page: @Composable (Modifier) -> Unit = { modifier ->
        Box(modifier) {
            when (s) {
                null -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Loading(t("notes.history.loading")) }
                is Shown.Failed -> Txt(NoteShare.error(s.error, t("notes.history.couldNotOpen")), style = Nx.type.bodySmall, color = c.textMuted, modifier = Modifier.padding(18.dp))
                is Shown.Doc -> VersionView(
                    s.doc,
                    if (version != null) t("notes.history.savedBy", "name" to who(version), "when" to Time.exact(version.savedAt)) else t("notes.history.currentNote"),
                )
            }
        }
    }

    Column(Modifier.fillMaxSize().navigationBarsPadding()) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .drawBehind { drawRect(c.borderSubtle, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
                .padding(start = 8.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Row(
                Modifier
                    .height(40.dp)
                    .clip(Radii.Sm)
                    .background(if (pressed) c.bgHover else Color.Transparent)
                    .pressable(interaction) { back() }
                    .padding(start = 6.dp, end = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon("ArrowLeft", if (pressed) c.textStrong else c.textSubtle, size = 18.dp)
                Txt(
                    if (narrow && picked != null) t("notes.history.allVersions") else t("notes.history.backToNote"),
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)),
                    color = if (pressed) c.textStrong else c.textSubtle,
                    maxLines = 1,
                )
            }
            if (!narrow || picked == null) {
                Txt(
                    t("notes.history.title"),
                    style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(680)),
                    color = c.textStrong,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 6.dp).semantics { heading() },
                )
            }
            Spacer(Modifier.weight(1f))
            if (canPutBack) NxButton(t("notes.history.restore"), { restore() }, size = ButtonSize.SM, icon = "RotateCcw", loading = busy)
        }
        if (narrow) {
            if (picked != null) page(Modifier.weight(1f).fillMaxWidth()) else rail(Modifier.weight(1f).fillMaxWidth())
        } else Row(Modifier.weight(1f).fillMaxWidth()) {
            page(Modifier.weight(1f).fillMaxHeight())
            Box(
                Modifier
                    .width(272.dp)
                    .fillMaxHeight()
                    .drawBehind { drawRect(c.borderSubtle, size = Size(1.dp.toPx(), size.height)) },
            ) { rail(Modifier.fillMaxSize()) }
        }
    }
}

/** One version in the list (.version): picked, it is lit like a chosen row. */
@Composable
private fun VersionButton(on: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Sm
    Column(
        Modifier
            .fillMaxWidth()
            .then(if (on) Modifier.background(c.bgSelected, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight) else Modifier.background(if (pressed) c.bgHover else Color.Transparent, shape))
            .clip(shape)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 12.dp)
            .semantics { selected = on },
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) { content() }
}

/** One version of a note, as it read then. */
@Composable
private fun VersionView(doc: NoteDoc, note: String) {
    val c = Nx.colors
    val ctx = remember(doc.files) {
        RenderCtx(
            files = true,
            max = NoteModel.MAX_CHARS,
            bodyPx = 16.5f,
            bodyLine = 28f,
            gap = 6.6.dp,
            renderFile = { id, name, width, align -> Box(Modifier.fillMaxWidth().padding(vertical = 16.dp)) { NoteFileView(doc.files[id], name, null, width, align) } },
        )
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 128.dp)) {
            Txt(note, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textMuted, modifier = Modifier.padding(bottom = 14.dp))
            Txt(
                NoteModel.name(doc.title),
                style = Nx.type.title.copy(fontSize = Nx.type.sp(24f), lineHeight = Nx.type.sp(28.8f), fontWeight = FontWeight(720), letterSpacing = (-0.018).em),
                color = if (doc.title.isBlank()) c.textMuted else c.textStrong,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(22.dp))
            if (doc.md.isNotBlank()) MarkdownView(doc.md, ctx) else Txt(t("notes.reader.empty"), style = Nx.type.body, color = c.textMuted)
        }
    }
}
