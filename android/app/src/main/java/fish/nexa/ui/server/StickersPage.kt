package fish.nexa.ui.server

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.media.Media
import fish.nexa.net.ApiError
import fish.nexa.net.Sticker
import fish.nexa.net.StickerPack
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleLine
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.markdown.AppLinks
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val IMAGE_TYPES = arrayOf("image/png", "image/gif", "image/webp", "image/apng")
private const val MAX_STICKER = 5 * 1024 * 1024

fun packCover(p: StickerPack): Sticker? = p.stickers.firstOrNull { it.id == p.coverStickerId } ?: p.stickers.firstOrNull()

/** "3 stickers", "12 emoji", in the reader's language. */
fun packCount(p: StickerPack): String =
    if (p.kind == "emoji") t("server.packEditor.emojiCount", "count" to p.stickers.size) else t("server.packEditor.stickerCount", "count" to p.stickers.size)

fun packUrl(id: String) = AppLinks.shareOrigin(Nexa.api.baseUrl) + "/stickers/pack/" + id

/** A sticker's picture: moving pictures move; a TGS or WebM shows its first frame. */
@Composable
fun StickerImage(pack: StickerPack, s: Sticker, css: Int, modifier: Modifier) {
    val density = LocalDensity.current.density
    val url = if (pack.kind == "emoji") Media.emojiUrl(s.blobId, 48, density)
    else Media.stickerUrl(s.blobId, css, density) + if (s.format == "tgs" || s.format == "webm") "&still=1" else ""
    AsyncImage(url, s.name, Media.loader, modifier, contentScale = ContentScale.Fit)
}

/** Server Settings, Stickers: the packs that belong to this server; managing them needs Manage Expressions. */
@Composable
fun ServerStickersPage(serverId: String) {
    val servers by Nexa.servers.byId.collectAsState()
    val packs by Nexa.expressions.packs.collectAsState()
    val st = servers[serverId]
    val manage = Nexa.servers.canI(st, P.MANAGE_EMOJIS)
    val list = packs.values.filter { it.serverId == serverId }.sortedByDescending { it.updatedAt }
    var selected by remember { mutableStateOf<String?>(null) }
    val pack = list.firstOrNull { it.id == selected } ?: list.firstOrNull()

    fun create() = promptText(
        t("server.serverStickers.createServerPack"),
        PromptField("name", t("server.packEditor.packName"), t("server.serverStickers.defaultPackName", "name" to (st?.server?.name ?: t("settings.settingsScreen.server"))), maxLength = 60, capitalize = true),
        t("settings.stickers.create"),
    ) { name ->
        if (name.isBlank()) return@promptText
        Nexa.scope.launch {
            try {
                val p = Nexa.api.request("POST", "/stickers/packs", StickerPack.serializer(), buildJsonObject {
                    put("name", name.trim())
                    put("server_id", serverId)
                })
                Nexa.expressions.upsertPack(p)
                selected = p.id
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.serverStickers.couldNotCreateThePack"), "error")
            }
        }
    }

    if (pack != null) key(pack.id) { PackDetail(pack, manage, { selected = null }) { Header(list, pack.id, manage, { selected = it }, ::create) } }
    else SettingsPage { Header(list, null, manage, { selected = it }, ::create) }
}

/** The title, the hint, Create Server Pack and the pack list (above the editor on a phone). */
@Composable
private fun Header(list: List<StickerPack>, selected: String?, manage: Boolean, onSelect: (String) -> Unit, onCreate: () -> Unit) {
    val c = Nx.colors
    PageTitle(t("pickers.expressionPicker.stickers"), Modifier.padding(bottom = 0.dp))
    Hint(t("server.serverStickers.stickerPacksThatBelongToThis"), Modifier.padding(bottom = 16.dp))
    if (manage) Box(Modifier.padding(bottom = 8.dp)) {
        NxButton(t("server.serverStickers.createServerPack"), { Holds.unlessUnsaved(onCreate) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Plus")
    }
    if (list.isEmpty()) EmptyNote(if (manage) t("server.serverStickers.thisServerHasNoStickerPacks") else t("server.serverStickers.thisServerHasNoStickerPacks2"))
    Column(Modifier.padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (p in list) key(p.id) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            val on = p.id == selected
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(Radii.Xs)
                    .background(if (on) c.bgSelected else if (pressed) c.bgHover else Color.Transparent)
                    .pressable(interaction) { if (!on) Holds.unlessUnsaved { onSelect(p.id) } }
                    .semantics { this.selected = on }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(32.dp).background(c.bgSurface, Radii.Xs).clip(Radii.Xs), contentAlignment = Alignment.Center) {
                    val cover = packCover(p)
                    if (cover != null) StickerImage(p, cover, 64, Modifier.fillMaxSize())
                    else Txt(p.name.take(1).uppercase(), style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.text)
                }
                Column(Modifier.weight(1f)) {
                    Txt(p.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = if (on) c.textStrong else c.textChannel, maxLines = 1)
                    Txt(packCount(p) + if (p.public) " · " + t("settings.stickers.publicTag") else "", style = Nx.type.hint, color = c.textMuted, maxLines = 1)
                }
            }
        }
    }
}

/** A file staged for upload, with the name and tags it will have. */
private class Staged(val file: Picked, name: String, val format: String?) {
    var name by mutableStateOf(name)
    var tags by mutableStateOf("")
}

/**
 * PackDetail: the pack's name, description and whether it is public; files
 * staged with their names and tags until Upload; then every sticker in its
 * order, each to make the cover, rename, delete or move.
 */
@Composable
private fun PackDetail(pack: StickerPack, manage: Boolean, onDeleted: () -> Unit, header: @Composable () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(pack.name) }
    var description by remember { mutableStateOf(pack.description) }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val staged = remember { mutableStateListOf<Staged>() }
    val isEmoji = pack.kind == "emoji"
    val noun = if (isEmoji) "emoji" else "sticker"
    val maxBytes = if (isEmoji) 2 * 1024 * 1024 else MAX_STICKER
    val dirty = name != pack.name || description != pack.description

    suspend fun refresh() {
        Nexa.expressions.upsertPack(Nexa.api.get("/stickers/packs/${pack.id}", StickerPack.serializer()))
    }

    fun save() {
        busy = true
        scope.launch {
            try {
                val saved = Nexa.api.request("PATCH", "/stickers/packs/${pack.id}", StickerPack.serializer(), buildJsonObject {
                    if (name != pack.name) put("name", name)
                    if (description != pack.description) put("description", description)
                })
                Nexa.expressions.upsertPack(saved)
                // the server tidies whitespace: show what it kept, or the save bar never goes away
                name = saved.name
                description = saved.description
                Nexa.ui.toast(t("server.packEditor.packSaved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotSaveThePack"), "error")
            } finally {
                busy = false
            }
        }
    }

    fun setPublic(v: Boolean) = scope.launch {
        try {
            Nexa.expressions.upsertPack(Nexa.api.request("PATCH", "/stickers/packs/${pack.id}", StickerPack.serializer(), buildJsonObject { put("public", v) }))
        } catch (e: Exception) {
            Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotChangeVisibility"), "error")
        }
    }

    fun stage(uris: List<android.net.Uri>) = scope.launch {
        for (u in uris) {
            val f = runCatching { ServerApi.read(context, u) }.getOrNull() ?: continue
            // a .tgs usually arrives with no usable type, so its name says what it is; video stickers arrive as video/webm
            val tgs = f.name.lowercase().endsWith(".tgs")
            val format = if (f.type == "video/webm") "webm" else if (tgs) "tgs" else null
            if (f.type !in IMAGE_TYPES && !(format != null && !isEmoji)) {
                Nexa.ui.toast(t(if (isEmoji) "server.packEditor.mustBeAnImage" else "server.packEditor.stickersMustBeImages", "name" to f.name), "error")
                continue
            }
            if (f.bytes.size > maxBytes) {
                Nexa.ui.toast(t("server.packEditor.isLargerThan", "name" to f.name, "megabytes" to maxBytes / (1024 * 1024)), "error")
                continue
            }
            val base = f.name.replace(Regex("\\.[a-z0-9]+$", RegexOption.IGNORE_CASE), "")
            val clean = if (isEmoji) base.replace(Regex("[^A-Za-z0-9_]+"), "_").trim('_').take(32) else base.take(30)
            staged += Staged(f, clean.ifEmpty { noun }, format)
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) stage(uris) }
    fun choose() = pick.launch(if (isEmoji) IMAGE_TYPES else IMAGE_TYPES + arrayOf("video/webm", "application/x-tgsticker", "application/gzip", "application/octet-stream"))

    fun uploadAll() {
        busy = true
        // each leaves the list as soon as it is in, so a retry after a failure only sends what is left
        val batch = staged.toList()
        var done = 0
        scope.launch {
            try {
                for (s in batch) {
                    val type = if (s.format == "tgs") "application/octet-stream" else s.file.type
                    ServerApi.upload("POST", "/stickers/packs/${pack.id}/stickers?name=${ServerApi.enc(s.name.trim().ifEmpty { "sticker" })}&tags=${ServerApi.enc(s.tags.trim())}", s.file.bytes, type)
                    staged.remove(s)
                    done++
                }
                refresh()
                Nexa.ui.toast(t(if (isEmoji) "server.packEditor.emojiAdded" else "server.packEditor.stickersAdded", "count" to done), "success")
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("composer.composer.uploadFailed"), "error")
                runCatching { refresh() }
            } finally {
                busy = false
            }
        }
    }

    fun rename(s: Sticker) = promptFields(
        if (isEmoji) t("server.packEditor.editEmoji") else t("server.packEditor.editSticker"),
        listOf(
            PromptField("name", t("modals.subchat.name"), s.name, maxLength = 30),
            PromptField("tags", t("server.packEditor.tags"), s.tags, hint = t("server.packEditor.spaceSeparatedUsedBySearch"), maxLength = 200),
        ),
        t("chat.editMessage.save"),
    ) { v ->
        scope.launch {
            try {
                Nexa.api.request("PATCH", "/stickers/packs/${pack.id}/stickers/${s.id}", buildJsonObject {
                    put("name", (v["name"] ?: "").trim().take(30).ifEmpty { s.name })
                    put("tags", (v["tags"] ?: "").trim().take(200))
                })
                refresh()
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotRename"), "error")
            }
        }
    }

    fun remove(s: Sticker) = confirm(t("server.packEditor.deleteNamed", "name" to s.name), t("server.packEditor.thisStickerIsRemovedFromThe"), t("server.packEditor.deleteSticker")) {
        Nexa.api.request("DELETE", "/stickers/packs/${pack.id}/stickers/${s.id}")
        refresh()
    }

    fun setCover(s: Sticker) = scope.launch {
        try {
            Nexa.expressions.upsertPack(Nexa.api.request("PATCH", "/stickers/packs/${pack.id}", StickerPack.serializer(), buildJsonObject { put("cover_sticker_id", s.id) }))
        } catch (e: Exception) {
            Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotSetTheCover"), "error")
        }
    }

    /** Sends a whole new order, which is what the endpoint takes. */
    fun move(s: Sticker, delta: Int) {
        val list = pack.stickers.toMutableList()
        val at = list.indexOfFirst { it.id == s.id }
        val to = at + delta
        if (at < 0 || to < 0 || to >= list.size) return
        list.add(to, list.removeAt(at))
        scope.launch {
            try {
                val body = JsonArray(list.mapIndexed { i, x -> buildJsonObject { put("id", x.id); put("position", i) } })
                Nexa.expressions.upsertPack(Nexa.api.request("PATCH", "/stickers/packs/${pack.id}/stickers", StickerPack.serializer(), body))
                Nexa.ui.toast(t("reorder.nameIsNowIndexOfCount", "name" to s.name, "index" to to + 1, "count" to list.size))
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.packEditor.couldNotReorder")), "error")
            }
        }
    }

    fun toggleInstall() {
        busy = true
        scope.launch {
            try {
                if (pack.installed) {
                    Nexa.api.request("DELETE", "/stickers/packs/${pack.id}/install")
                    Nexa.expressions.upsertPack(pack.copy(installed = false))
                } else Nexa.expressions.upsertPack(Nexa.api.request("PUT", "/stickers/packs/${pack.id}/install", StickerPack.serializer()))
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotChangeThePack"), "error")
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }

    SettingsPage(if (manage) SaveState(dirty, busy, { name = pack.name; description = pack.description }, ::save) else null) {
        header()
        Wrap(Modifier.fillMaxWidth().padding(bottom = 16.dp), gap = 12.dp) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt(pack.name, style = Nx.type.heading.copy(fontSize = Nx.type.sp(21f), fontWeight = FontWeight(690)), color = c.textStrong)
                Txt(
                    packCount(pack) + " · " + (if (pack.public) t("server.packEditor.publicAnyoneWithTheLink") else t("server.packEditor.privateOnlyYouCanSeeIt")) +
                        (if (pack.serverId != null) " · " + t("server.packEditor.serverPack") else ""),
                    style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)),
                    color = c.textMuted,
                )
            }
            if (!manage) NxButton(if (pack.installed) t("server.packEditor.remove") else t("server.packEditor.install"), { toggleInstall() }, kind = if (pack.installed) ButtonKind.SECONDARY else ButtonKind.PRIMARY, size = ButtonSize.SM, loading = busy)
            else NxButton(t("server.packEditor.deletePack"), {
                confirm(t("server.packEditor.deleteNamed", "name" to pack.name), t("server.packEditor.everyoneWhoInstalledThisPackLoses"), t("server.packEditor.deletePack")) {
                    Nexa.api.request("DELETE", "/stickers/packs/${pack.id}")
                    Nexa.expressions.removePack(pack.id)
                    onDeleted()
                }
            }, kind = ButtonKind.DANGER, size = ButtonSize.SM, icon = "Trash2")
        }
        if (manage) {
            Form {
                NxTextField(name, { name = it.take(100) }, label = t("server.packEditor.packName"), required = true, capitalize = true)
                NxTextField(
                    description, { description = it.take(500) },
                    label = t("server.packEditor.description"), hint = t("server.packEditor.shownWhenPeopleFindThePack"),
                    singleLine = false, minLines = 2, imeAction = ImeAction.Default, capitalize = true, autoCorrect = true,
                )
            }
            Box(Modifier.padding(top = 12.dp)) {
                ToggleLine(t("server.packEditor.publicPack"), pack.public, { setPublic(it) }, description = t("server.packEditor.anyoneWithTheLinkCanInstall"))
            }
            if (pack.public) Wrap(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Txt(packUrl(pack.id), style = Nx.type.code.copy(fontSize = Nx.type.sp(13f)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f).surfaceCard(c, Radii.Sm).padding(horizontal = 10.dp, vertical = 10.dp))
                NxButton(
                    if (copied) t("modals.groupInvite.copied") else t("server.packEditor.copyLink"),
                    {
                        val cm = Nexa.app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("Nexa", packUrl(pack.id)))
                        copied = true
                    },
                    kind = if (copied) ButtonKind.POSITIVE else ButtonKind.SECONDARY, size = ButtonSize.SM, icon = if (copied) "Check" else "Copy",
                )
            }
            DropZone(
                t("android.server.stickerChoose", "size" to maxBytes / (1024 * 1024)) + " " +
                    (if (isEmoji) t("server.packEditor.emojiNamesAreLettersNumbersAnd") else t("server.packEditor.stickerFormatsNote")),
            ) { choose() }
            for (s in staged) key(s) {
                Wrap(Modifier.fillMaxWidth().padding(top = 8.dp).background(c.bgSurface, Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp), gap = 12.dp) {
                    Box(Modifier.size(48.dp).background(c.bgRaised, Radii.Xs).clip(Radii.Xs), contentAlignment = Alignment.Center) {
                        if (s.format == null) AsyncImage(s.file.bytes, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                        else Icon(if (s.format == "webm") "Film" else "Sparkles", c.textMuted, size = 22.dp)
                    }
                    Box(Modifier.weight(1f).widthIn(min = 140.dp)) {
                        NxTextField(s.name, { s.name = it.take(30) }, placeholder = t("modals.subchat.name"))
                    }
                    if (!isEmoji) Box(Modifier.weight(1f).widthIn(min = 140.dp)) {
                        NxTextField(s.tags, { s.tags = it.take(200) }, placeholder = t("server.packEditor.tagsSpaceSeparated"))
                    }
                    NxButton(t("composer.composer.remove"), { staged.remove(s) }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
                }
            }
            if (staged.isNotEmpty()) Box(Modifier.padding(top = 8.dp)) {
                NxButton(
                    if (isEmoji) t("server.packEditor.uploadEmojiCount", "count" to staged.size) else t("server.packEditor.uploadStickerCount", "count" to staged.size),
                    { uploadAll() }, size = ButtonSize.SM, loading = busy,
                )
            }
        } else if (pack.description.isNotEmpty()) Txt(pack.description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
        if (manage && pack.stickers.size > 1) Hint(t("android.server.reorderGridHint"), Modifier.padding(top = 8.dp))
        StickerGrid(Modifier.padding(top = 16.dp)) {
            pack.stickers.forEachIndexed { i, s ->
                key(s.id) {
                    StickerCell(pack, s, manage,
                        onCover = { setCover(s) }, onRename = { rename(s) }, onDelete = { remove(s) },
                        onMenu = if (manage) ({
                            openMenu(
                                buildList {
                                    if (i > 0) add(MenuItem.Action(t("reorder.moveEarlier")) { move(s, -1) })
                                    if (i < pack.stickers.lastIndex) add(MenuItem.Action(t("reorder.moveLater")) { move(s, 1) })
                                },
                                title = s.name,
                            )
                        }) else null,
                    )
                }
            }
        }
        if (pack.stickers.isEmpty()) EmptyNote(if (manage) t(if (isEmoji) "server.packEditor.addYourFirstEmoji" else "server.packEditor.addYourFirstSticker") else t("pickers.stickerPicker.thisPackIsEmpty"))
    }
}

/** `.grid`: cells at least 120 dp wide, as many to a row as fit. */
@Composable
private fun StickerGrid(modifier: Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier.fillMaxWidth()) { measurables, constraints ->
        val gap = 12.dp.roundToPx()
        val min = 120.dp.roundToPx()
        val width = constraints.maxWidth
        val cols = maxOf(1, (width + gap) / (min + gap))
        val cell = (width - gap * (cols - 1)) / cols
        val placeables = measurables.map { it.measure(Constraints(minWidth = cell, maxWidth = cell)) }
        val rows = placeables.chunked(cols)
        val heights = rows.map { r -> r.maxOf { it.height } }
        val height = heights.sum() + maxOf(0, rows.size - 1) * gap
        layout(width, height) {
            var y = 0
            rows.forEachIndexed { ri, r ->
                r.forEachIndexed { ci, p -> p.placeRelative(ci * (cell + gap), y) }
                y += heights[ri] + gap
            }
        }
    }
}

/** `.cell`: the sticker, its name and tags; on a phone the buttons sit in a row of their own under them. Hold it to move it. */
@Composable
private fun StickerCell(pack: StickerPack, s: Sticker, manage: Boolean, onCover: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit, onMenu: (() -> Unit)?) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        Modifier
            .background(c.bgSurface, Radii.Sm)
            .clip(Radii.Sm)
            .then(if (onMenu != null) Modifier.pressable(interaction, onLongClick = onMenu) {} else Modifier)
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box {
            Box(Modifier.fillMaxWidth().aspectRatio(1f).background(c.bgRaised, Radii.Xs).clip(Radii.Xs)) {
                StickerImage(pack, s, 160, Modifier.fillMaxSize())
            }
            if (pack.coverStickerId == s.id || (pack.coverStickerId == null && pack.stickers.firstOrNull()?.id == s.id)) Box(
                Modifier.padding(6.dp).background(brandGradient(c), Radii.Pill).padding(horizontal = 8.dp, vertical = 2.dp),
            ) { Txt(t("server.packEditor.cover"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f), fontWeight = FontWeight(700)), color = c.onBrand) }
        }
        Txt(s.name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
        Txt(s.tags, style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f)), color = c.textMuted, maxLines = 1)
        if (manage) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
            RowIconButton("Star", t("server.packEditor.setAsCover"), onCover, size = 36.dp)
            RowIconButton("Pencil", t("server.packEditor.rename"), onRename, size = 36.dp)
            RowIconButton("Trash2", t("server.packEditor.deleteSticker"), onDelete, danger = true, size = 36.dp)
        }
    }
}
