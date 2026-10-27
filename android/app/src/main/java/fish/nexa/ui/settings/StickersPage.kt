package fish.nexa.ui.settings

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.media.Media
import fish.nexa.net.ApiError
import fish.nexa.net.Sticker
import fish.nexa.net.StickerPack
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.auth.ErrorBox
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

private val ACCEPT_IMAGE = setOf("image/png", "image/gif", "image/webp", "image/apng")
private const val MAX_STICKER = 5L * 1024 * 1024
private const val MAX_EMOJI = 2L * 1024 * 1024

private fun isEmoji(p: StickerPack) = p.kind == "emoji"
private fun packCover(p: StickerPack): Sticker? = p.stickers.firstOrNull { it.id == p.coverStickerId } ?: p.stickers.firstOrNull()
private fun packCount(p: StickerPack) = if (isEmoji(p)) t("server.packEditor.emojiCount", "count" to p.stickers.size) else t("server.packEditor.stickerCount", "count" to p.stickers.size)
private fun packUrl(id: String) = "${Nexa.api.baseUrl}/stickers/pack/$id"

/** canRemovePack: installed, not mine, and not a pack of a server I am in (those are managed there). */
private fun canRemove(p: StickerPack, me: String?): Boolean = p.installed && p.ownerUserId != me && (p.serverId == null || Nexa.servers.get(p.serverId) == null)

private suspend fun fetchPack(id: String): StickerPack = Nexa.api.get("/stickers/packs/$id", StickerPack.serializer()).also { Nexa.expressions.upsertPack(it) }

/** A sticker's or an emoji's picture, still (the server renders a moving one's first frame). */
@Composable
private fun ItemImage(s: Sticker, emoji: Boolean, size: Dp, modifier: Modifier = Modifier) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val density = LocalDensity.current.density
    val moving = s.animated || s.format == "tgs" || s.format == "webm"
    val url = if (emoji) Media.emojiUrl(s.blobId, size.value.toInt(), density, still = moving) else Media.stickerUrl(s.blobId, size.value.toInt(), density) + if (moving) "&still=1" else ""
    AsyncImage(model = url, contentDescription = s.name, imageLoader = Media.loader, modifier = modifier, contentScale = ContentScale.Fit)
}

/** 3.11 Emoji & Stickers: your packs of each kind, and public packs to install. */
@Composable
fun StickersPage() {
    val host = LocalAnchors.current
    var tab by remember { mutableStateOf("stickers") }
    var editing by remember { mutableStateOf<String?>(null) }
    // a pack opens as a level of its own; back comes to the list
    DisposableEffect(editing) {
        host?.inner = if (editing != null) ({ PackEditing.close(); editing = null }) else null
        onDispose { if (editing != null) host?.inner = null }
    }
    DisposableEffect(Unit) { onDispose { PackEditing.close() } }
    LaunchedEffect(editing) { host?.scroll?.scrollTo(0) }
    val open = editing
    if (open != null) {
        PackView(open, onBack = { Unsaved.unlessUnsaved { PackEditing.close(); editing = null } })
        return
    }
    PageTitle(t("settings.stickers.expressionPacks"))
    Hint(t("settings.stickers.buildYourOwnEmojiAndSticker"), Modifier.padding(bottom = 14.dp).settingAnchor("packs"))
    Segmented(
        listOf(t("pickers.expressionPicker.stickers") to "stickers", t("modals.customStatus.emoji") to "emoji", t("settings.stickers.discover") to "discover"), tab,
        { tab = it },
        label = t("settings.groups.emojiStickers"),
    )
    Column(Modifier.padding(top = 16.dp)) {
        when (tab) {
            "discover" -> Discover { p ->
                tab = if (isEmoji(p)) "emoji" else "stickers"
                editing = p.id
            }
            else -> MyPacks(if (tab == "emoji") "emoji" else "sticker") { editing = it }
        }
    }
}

@Composable
private fun MyPacks(kind: String, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val me = Nexa.users.me.collectAsState().value?.id
    val packs by Nexa.expressions.packs.collectAsState()
    val mine = packs.values
        .filter { it.kind == kind && ((it.serverId == null && (it.ownerUserId == me || it.installed)) || canRemove(it, me)) }
        .sortedWith(compareByDescending<StickerPack> { it.ownerUserId == me }.thenByDescending { it.updatedAt })
    NxButton(
        t(if (kind == "emoji") "settings.stickers.createEmojiPack" else "settings.stickers.createStickerPack"),
        { openCreatePack(kind, onOpen) }, icon = "Plus", block = true,
    )
    Column(Modifier.padding(top = 14.dp)) {
        if (mine.isEmpty()) EmptyBox(t(if (kind == "emoji") "settings.stickers.noEmojiPacksYet" else "settings.stickers.noStickerPacksYet"))
        for (p in mine) {
            val removable = canRemove(p, me)
            val tag = when {
                removable -> " · " + t("settings.stickers.installedTag")
                p.public -> " · " + t("settings.stickers.publicTag")
                else -> ""
            }
            PackRow(p, packCount(p) + tag, onClick = { onOpen(p.id) }) {
                if (removable) IconButton("X", t("pickers.stickerPicker.removePack"), { confirmRemovePack(p) }, tint = c.textMuted, size = 40.dp, iconSize = 18.dp)
            }
        }
    }
}

/** A pack in a list: its cover, name and count. */
@Composable
private fun PackRow(p: StickerPack, sub: String, onClick: () -> Unit, end: @Composable () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Md
    Row(
        Modifier
            .padding(bottom = 8.dp)
            .fillMaxWidth()
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, onClick = onClick)
            .heightIn(min = 64.dp)
            .padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(44.dp).sunken(Radii.Sm, c).ring(Radii.Sm, c.borderSubtle), contentAlignment = Alignment.Center) {
            val cover = packCover(p)
            if (cover != null) ItemImage(cover, isEmoji(p), 40.dp, Modifier.size(36.dp))
            else Txt(p.name.take(1).uppercase(), style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textMuted)
        }
        Column(Modifier.weight(1f)) {
            Txt(p.name, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
            Txt(sub, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
        }
        end()
    }
}

// ---- one pack ----

/** The name and description being edited, against what the server last said. */
class PackForm(val packId: String, name: String, description: String) {
    var name by mutableStateOf(name)
    var description by mutableStateOf(description)
    var savedName by mutableStateOf(name)
    var savedDescription by mutableStateOf(description)
    var saving by mutableStateOf(false)
    val dirty get() = name != savedName || description != savedDescription
}

object PackEditing {
    var form by mutableStateOf<PackForm?>(null)
    fun close() {
        form = null
    }
}

@Composable
private fun PackView(packId: String, onBack: () -> Unit) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me = Nexa.users.me.collectAsState().value?.id
    val packs by Nexa.expressions.packs.collectAsState()
    val pack = packs[packId]
    LaunchedEffect(packId) { runCatching { fetchPack(packId) } }
    BackRowTo(t("settings.groups.emojiStickers"), onBack)
    if (pack == null) {
        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Spinner() }
        return
    }
    val emoji = isEmoji(pack)
    val manage = pack.ownerUserId == me
    if (!manage) {
        PageTitle(pack.name)
        if (pack.description.isNotBlank()) Hint(pack.description, Modifier.padding(bottom = 12.dp))
        Txt(packCount(pack), style = Nx.type.bodySmall, color = c.textMuted)
        if (canRemove(pack, me)) NxButton(t("server.packEditor.remove"), { confirmRemovePack(pack) }, kind = ButtonKind.DANGER, size = ButtonSize.SM, modifier = Modifier.padding(top = 10.dp))
        ItemGrid(pack, emoji, null)
        return
    }
    val form = PackEditing.form?.takeIf { it.packId == packId } ?: PackForm(packId, pack.name, pack.description).also { PackEditing.form = it }
    var uploading by remember { mutableIntStateOf(0) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var done = 0
            uploading = uris.size
            try {
                for (uri in uris) {
                    if (uploadItem(ctx, pack, uri)) done++
                    uploading--
                }
                fetchPack(pack.id)
                if (done > 0) Nexa.ui.toast(t(if (emoji) "server.packEditor.emojiAdded" else "server.packEditor.stickersAdded", "count" to done), "success")
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("composer.composer.uploadFailed"), "error")
                runCatching { fetchPack(pack.id) }
            } finally {
                uploading = 0
            }
        }
    }

    PageTitle(pack.name)
    NxTextField(form.name, { form.name = it.take(100) }, label = t("server.packEditor.packName"), capitalize = true)
    NxTextField(form.description, { form.description = it.take(500) }, label = t("server.packEditor.description"), singleLine = false, minLines = 2, modifier = Modifier.padding(top = 12.dp), capitalize = true)
    // one change at a time: pressed again while one is on its way (or waits on a captcha), it waits
    var publicBusy by remember(pack.id) { mutableStateOf(false) }
    ToggleRow(t("server.packEditor.publicPack"), pack.public, { v ->
        if (!publicBusy) {
            publicBusy = true
            scope.launch {
                try {
                    Nexa.expressions.upsertPack(Nexa.api.request("PATCH", "/stickers/packs/${pack.id}", StickerPack.serializer(), buildJsonObject { put("public", v) }))
                } catch (e: Exception) {
                    Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotChangeVisibility"), "error")
                } finally {
                    publicBusy = false
                }
            }
        }
    }, t("server.packEditor.anyoneWithTheLinkCanInstall"), enabled = !publicBusy)
    if (pack.public) Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f).sunken(Radii.Sm, c).ring(Radii.Sm, c.borderSubtle).padding(horizontal = 12.dp, vertical = 10.dp)) {
            Txt(packUrl(pack.id), style = Nx.type.code.copy(fontSize = Nx.type.sp(13f)), color = c.text, maxLines = 1)
        }
        var copied by remember { mutableStateOf(false) }
        LaunchedEffect(copied) {
            if (copied) {
                delay(2000)
                copied = false
            }
        }
        NxButton(if (copied) t("modals.groupInvite.copied") else t("server.packEditor.copyLink"), {
            copied = copyText(ctx, packUrl(pack.id))
        }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = if (copied) "Check" else "Link")
    }
    SectionHeading(packCount(pack), trailing = {
        if (uploading > 0) Spinner(size = 20.dp)
        else NxButton(t(if (emoji) "android.settings.stickers.addEmoji" else "android.settings.stickers.addStickers"), {
            pick.launch(if (emoji) arrayOf("image/png", "image/gif", "image/webp", "image/apng") else arrayOf("image/png", "image/gif", "image/webp", "image/apng", "video/webm", "application/x-tgsticker", "application/gzip", "application/octet-stream"))
        }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Upload")
    })
    ItemGrid(pack, emoji) { s -> itemMenu(pack, s) }
    if (pack.stickers.isNotEmpty()) Hint(t("android.settings.stickers.tapToEdit"), Modifier.padding(top = 8.dp))
    Box(Modifier.padding(top = 24.dp)) {
        DangerBox(null, t("server.packEditor.everyoneWhoInstalledThisPackLoses"), t("server.packEditor.deletePack"), {
            fish.nexa.ui.shell.confirm(t("server.packEditor.deleteNamed", "name" to pack.name), t("server.packEditor.everyoneWhoInstalledThisPackLoses"), t("server.packEditor.deletePack")) {
                Nexa.api.request("DELETE", "/stickers/packs/${pack.id}")
                Nexa.expressions.removePack(pack.id)
                PackEditing.close()
                withContext(Dispatchers.Main) { onBack() }
            }
        })
    }
}

/** The way back from a pack to the list. */
@Composable
private fun BackRowTo(label: String, onBack: () -> Unit) {
    val c = Nx.colors
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Row(
        Modifier
            .padding(bottom = 10.dp)
            .heightIn(min = 44.dp)
            .clip(Radii.Sm)
            .pressable(remember { MutableInteractionSource() }, onClick = onBack)
            .semantics { contentDescription = t("server.settingsLayer.backTo", "name" to label) }
            .padding(end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(if (rtl) "ChevronRight" else "ChevronLeft", c.textMuted, size = 18.dp)
        Txt(label, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.textMuted)
    }
}

/** The pack's stickers or emoji, three a row; a tap opens what can be done with one. */
@Composable
private fun ItemGrid(pack: StickerPack, emoji: Boolean, onItem: ((Sticker) -> Unit)?) {
    val c = Nx.colors
    val items = pack.stickers.sortedBy { it.position }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        // whole pixels, so three never round to a hair over the row
        val w = with(androidx.compose.ui.platform.LocalDensity.current) { (((maxWidth - 16.dp).toPx() / 3).toInt()).toDp() }
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
            for (s in items) {
                val shape = Radii.Md
                Column(
                    Modifier
                        .width(w)
                        .ring(shape, c.borderSubtle)
                        .background(c.bgSurface, shape)
                        .clip(shape)
                        .then(if (onItem != null) Modifier.pressable(remember(s.id) { MutableInteractionSource() }, onLongClick = { onItem(s) }) { onItem(s) } else Modifier)
                        .padding(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) {
                        ItemImage(s, emoji, if (emoji) 48.dp else 96.dp, Modifier.fillMaxSize())
                        if (s.id == pack.coverStickerId) Box(Modifier.align(Alignment.TopEnd).size(20.dp).background(c.bgFloating, Radii.Xs), contentAlignment = Alignment.Center) {
                            Icon("Star", c.warning, size = 13.dp)
                        }
                    }
                    Txt(if (emoji) ":${s.name}:" else s.name, style = Nx.type.hint, color = c.textMuted, maxLines = 1)
                }
            }
        }
    }
}

/** What can be done with one sticker: rename and tag it, make it the cover, move it, delete it. */
private fun itemMenu(pack: StickerPack, s: Sticker) {
    val emoji = isEmoji(pack)
    val ordered = pack.stickers.sortedBy { it.position }
    val at = ordered.indexOfFirst { it.id == s.id }
    fun move(by: Int) {
        val list = ordered.toMutableList()
        val to = (at + by).coerceIn(0, list.size - 1)
        if (to == at) return
        list.add(to, list.removeAt(at))
        Nexa.scope.launch {
            try {
                Nexa.api.request("PATCH", "/stickers/packs/${pack.id}/stickers", buildJsonArray {
                    list.forEachIndexed { i, x -> add(buildJsonObject { put("id", x.id); put("position", i) }) }
                })
                fetchPack(pack.id)
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("modals.confirm.somethingWentWrong"), "error")
            }
        }
    }
    openMenu(
        listOfNotNull(
            MenuItem.Action(t(if (emoji) "server.packEditor.editEmoji" else "server.packEditor.editSticker")) { editItem(pack, s) },
            MenuItem.Action(t("server.packEditor.setAsCover"), disabled = pack.coverStickerId == s.id) {
                Nexa.scope.launch {
                    try {
                        Nexa.expressions.upsertPack(Nexa.api.request("PATCH", "/stickers/packs/${pack.id}", StickerPack.serializer(), buildJsonObject { put("cover_sticker_id", s.id) }))
                    } catch (e: Exception) {
                        Nexa.ui.toast((e as? ApiError)?.message ?: t("modals.confirm.somethingWentWrong"), "error")
                    }
                }
            },
            if (at > 0) MenuItem.Action(t("reorder.moveEarlier")) { move(-1) } else null,
            if (at < ordered.size - 1) MenuItem.Action(t("reorder.moveLater")) { move(1) } else null,
            MenuItem.Action(t("server.packEditor.deleteSticker"), danger = true) {
                fish.nexa.ui.shell.confirm(
                    t("server.packEditor.deleteNamed", "name" to s.name),
                    t("server.packEditor.thisStickerIsRemovedFromThe"),
                    t("server.packEditor.deleteSticker"),
                ) {
                    Nexa.api.request("DELETE", "/stickers/packs/${pack.id}/stickers/${s.id}")
                    fetchPack(pack.id)
                }
            },
        ),
        title = s.name,
    )
}

private fun editItem(pack: StickerPack, s: Sticker) {
    val emoji = isEmoji(pack)
    val ctl = SheetCtl(t(if (emoji) "server.packEditor.editEmoji" else "server.packEditor.editSticker"))
    var name by mutableStateOf(s.name)
    var tags by mutableStateOf(s.tags)
    fun save() {
        ctl.close()
        Nexa.scope.launch {
            try {
                Nexa.api.request("PATCH", "/stickers/packs/${pack.id}/stickers/${s.id}", buildJsonObject {
                    put("name", name.trim().take(30).ifEmpty { s.name })
                    put("tags", tags.trim().take(200))
                })
                fetchPack(pack.id)
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotRename"), "error")
            }
        }
    }
    openSettingsSheet("sticker-edit", ctl, footer = {
        NxButton(t("chat.editMessage.cancel"), { it.close() }, kind = ButtonKind.GHOST)
        NxButton(t("chat.editMessage.save"), { save() })
    }) {
        NxTextField(name, { name = it.take(30) }, label = t("modals.subchat.name"))
        NxTextField(tags, { tags = it.take(200) }, label = t("server.packEditor.tags"), hint = t("server.packEditor.spaceSeparatedUsedBySearch"), imeAction = ImeAction.Done, onIme = { save() })
    }
}

/** Uploads one picked file to a pack, named from its file name as the web names it; false when it was not a kind the pack takes. */
private suspend fun uploadItem(ctx: android.content.Context, pack: StickerPack, uri: Uri): Boolean {
    val emoji = isEmoji(pack)
    val cr = ctx.contentResolver
    val fileName = runCatching { cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } }.getOrNull() ?: "sticker"
    val size = runCatching { cr.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { if (it.moveToFirst()) it.getLong(0) else -1L } }.getOrNull() ?: -1L
    var mime = cr.getType(uri) ?: ""
    // a .tgs file usually comes with no useful type, so it is known by its name; video stickers are WebM
    val tgs = fileName.lowercase().endsWith(".tgs")
    if (tgs) mime = "application/x-tgsticker"
    val ok = mime in ACCEPT_IMAGE || (!emoji && (mime == "video/webm" || tgs))
    if (!ok) {
        Nexa.ui.toast(t(if (emoji) "server.packEditor.mustBeAnImage" else "server.packEditor.stickersMustBeImages", "name" to fileName), "error")
        return false
    }
    val max = if (emoji) MAX_EMOJI else MAX_STICKER
    if (size > max) {
        Nexa.ui.toast(t("server.packEditor.isLargerThan", "name" to fileName, "megabytes" to (max / (1024 * 1024)).toInt()), "error")
        return false
    }
    val base = fileName.replace(Regex("\\.[a-z0-9]+$", RegexOption.IGNORE_CASE), "")
    val clean = if (emoji) base.replace(Regex("[^A-Za-z0-9_]+"), "_").trim('_').take(32) else base.take(30)
    val name = clean.ifEmpty { if (emoji) "emoji" else "sticker" }
    val bytes = withContext(Dispatchers.IO) { cr.openInputStream(uri)?.use { it.readBytes() } } ?: return false
    if (bytes.size > max) {
        Nexa.ui.toast(t("server.packEditor.isLargerThan", "name" to fileName, "megabytes" to (max / (1024 * 1024)).toInt()), "error")
        return false
    }
    val path = "/stickers/packs/${pack.id}/stickers?name=${URLEncoder.encode(name, "UTF-8").replace("+", "%20")}&tags="
    val req = Nexa.api.requestBuilder(path).post(bytes.toRequestBody((mime.ifEmpty { "application/octet-stream" }).toMediaType())).build()
    Nexa.api.execute(Nexa.api.transfer, req, true)
    return true
}

/** The bar that saves a pack's name and description, over the bottom of the page while they differ. */
@Composable
fun BoxScope.PackSaveBar() {
    val form = PackEditing.form
    SaveBar(
        dirty = form?.dirty == true,
        saving = form?.saving == true,
        onReset = {
            form?.let {
                it.name = it.savedName
                it.description = it.savedDescription
            }
        },
        onSave = {
            val f = form ?: return@SaveBar
            f.saving = true
            Nexa.scope.launch(Dispatchers.Main) {
                try {
                    val saved = Nexa.api.request("PATCH", "/stickers/packs/${f.packId}", StickerPack.serializer(), buildJsonObject {
                        if (f.name != f.savedName) put("name", f.name)
                        if (f.description != f.savedDescription) put("description", f.description)
                    })
                    Nexa.expressions.upsertPack(saved)
                    // the server tidies spaces: what it kept is what shows, or the bar would never go
                    f.name = saved.name
                    f.description = saved.description
                    f.savedName = saved.name
                    f.savedDescription = saved.description
                    Nexa.ui.toast(t("server.packEditor.packSaved"), "success")
                } catch (e: Exception) {
                    Nexa.ui.toast((e as? ApiError)?.message ?: t("server.packEditor.couldNotSaveThePack"), "error")
                } finally {
                    f.saving = false
                }
            }
        },
    )
}

// ---- making a pack, and Telegram's ----

private fun openCreatePack(kind: String, onCreated: (String) -> Unit) {
    val emoji = kind == "emoji"
    val ctl = SheetCtl(t(if (emoji) "settings.stickers.createEmojiPack" else "settings.stickers.createStickerPack"))
    var name by mutableStateOf(t(if (emoji) "settings.stickers.myEmoji" else "settings.stickers.myStickers"))
    var busy by mutableStateOf(false)
    var importing by mutableStateOf(false)
    var link by mutableStateOf("")
    var progress by mutableStateOf<String?>(null)
    var fraction by mutableStateOf(0f)
    var error by mutableStateOf<String?>(null)
    var job: kotlinx.coroutines.Job? = null
    fun create() {
        if (busy || name.isBlank()) return
        busy = true
        Nexa.scope.launch(Dispatchers.Main) {
            try {
                val p = Nexa.api.request("POST", "/stickers/packs", StickerPack.serializer(), buildJsonObject {
                    put("name", name.trim())
                    put("kind", kind)
                })
                Nexa.expressions.upsertPack(p)
                ctl.close()
                onCreated(p.id)
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("server.serverStickers.couldNotCreateThePack"), "error")
            } finally {
                busy = false
            }
        }
    }
    fun import() {
        if (busy || link.isBlank()) return
        busy = true
        error = null
        progress = t("settings.stickers.importing")
        fraction = 0f
        job = Nexa.scope.launch(Dispatchers.Main) {
            try {
                val done = importTelegram(link.trim()) { phase, d, total ->
                    progress = t(if (phase == "store") "settings.stickers.savingStickers" else "settings.stickers.fetchingStickers", "done" to d, "total" to total)
                    fraction = if (total > 0) d.toFloat() / total else 0f
                }
                val pack = wireJson.decodeFromJsonElement(StickerPack.serializer(), done["pack"]!!)
                Nexa.expressions.upsertPack(pack)
                fun n(k: String) = (done[k] as? JsonPrimitive)?.intOrNull ?: 0
                var text = t("settings.stickers.importedToast", "imported" to n("imported"))
                if (n("skipped") > 0) text += " " + t("settings.stickers.importedSkipped", "skipped" to n("skipped"))
                if (n("failed") > 0) text += " " + t("settings.stickers.importedFailed", "failed" to n("failed"))
                Nexa.ui.toast(text, "success")
                ctl.close()
                onCreated(pack.id)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = (e as? ApiError)?.message ?: t("settings.stickers.importFailed")
            } finally {
                busy = false
                progress = null
            }
        }
    }
    openSettingsSheet("pack-create", ctl, footer = { sheet ->
        if (importing) NxButton(t("settings.stickers.back"), {
            job?.cancel()
            importing = false
            ctl.title = t("settings.stickers.createStickerPack")
        }, kind = ButtonKind.GHOST, enabled = !busy)
        NxButton(t("chat.editMessage.cancel"), {
            job?.cancel()
            sheet.close()
        }, kind = ButtonKind.GHOST)
        if (importing) NxButton(t("settings.stickers.importButton"), { import() }, loading = busy, enabled = link.isNotBlank())
        else NxButton(t("settings.stickers.create"), { create() }, loading = busy, enabled = name.isNotBlank())
    }) {
        val c = Nx.colors
        if (!importing) {
            NxTextField(name, { name = it.take(60) }, label = t("server.packEditor.packName"), imeAction = ImeAction.Done, onIme = { create() }, capitalize = true)
            if (!emoji) NxButton(t("settings.stickers.importTelegram"), {
                importing = true
                ctl.title = t("settings.stickers.importTitle")
            }, kind = ButtonKind.LINK)
        } else {
            Hint(t("settings.stickers.importHint"))
            NxTextField(link, { link = it }, label = t("settings.stickers.importLinkLabel"), placeholder = t("settings.stickers.importPlaceholder"), keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri, imeAction = ImeAction.Go, onIme = { import() })
            progress?.let { p ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().size(6.dp).sunken(Radii.Pill, c)) {
                        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).size(6.dp).background(fish.nexa.ui.theme.brandGradient(c), Radii.Pill))
                    }
                    Txt(p, style = Nx.type.hint, color = c.textMuted)
                }
            }
            error?.let { ErrorBox(it) }
        }
    }
}

/** POST …/import/telegram, read as it streams (NDJSON): progress lines, then the pack, or an error. */
private suspend fun importTelegram(url: String, onProgress: (phase: String, done: Int, total: Int) -> Unit): JsonObject = withContext(Dispatchers.IO) {
    val body = buildJsonObject { put("url", url) }.toString().toRequestBody("application/json".toMediaType())
    val req = Nexa.api.requestBuilder("/stickers/packs/import/telegram").header("Accept", "application/x-ndjson").post(body).build()
    val client = Nexa.api.transfer.newBuilder().callTimeout(150, java.util.concurrent.TimeUnit.SECONDS).build()
    Nexa.api.await(client.newCall(req)).use { res ->
        if (!res.isSuccessful) throw Nexa.api.errorOf(res.code, res.body.string(), res.header("Retry-After"), true)
        val reader = res.body.byteStream().bufferedReader()
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isBlank()) continue
            val o = runCatching { wireJson.parseToJsonElement(line).jsonObject }.getOrNull() ?: continue
            (o["error"] as? JsonObject)?.let { err ->
                throw ApiError(400, (err["code"] as? JsonPrimitive)?.contentOrNull ?: "import_failed", (err["message"] as? JsonPrimitive)?.contentOrNull ?: t("settings.stickers.importFailed"))
            }
            if ((o["done"] as? JsonPrimitive)?.contentOrNull == "true") return@withContext o
            val phase = (o["phase"] as? JsonPrimitive)?.contentOrNull ?: continue
            val d = (o["done"] as? JsonPrimitive)?.intOrNull ?: 0
            val total = (o["total"] as? JsonPrimitive)?.intOrNull ?: 0
            withContext(Dispatchers.Main) { onProgress(phase, d, total) }
        }
        throw ApiError(0, "import_failed", t("settings.stickers.importFailed"))
    }
}

/** packRemoval.ts: what removing a pack takes out of the picker, then out it goes. */
private fun confirmRemovePack(p: StickerPack) {
    val count = p.stickers.size
    val body = when {
        count == 0 -> t("packRemoval.itLeavesYourPicker")
        isEmoji(p) -> t("packRemoval.itsEmojiLeaveYourPicker", "count" to count)
        else -> t("packRemoval.itsStickersLeaveYourPicker", "count" to count)
    } + " " + t("packRemoval.youCanInstallItAgain")
    fish.nexa.ui.shell.confirm(t("packRemoval.removePackNamed", "name" to p.name), body, t("pickers.stickerPicker.removePack")) {
        try {
            Nexa.api.request("DELETE", "/stickers/packs/${p.id}/install")
        } catch (e: ApiError) {
            throw fish.nexa.ui.ReadableError(e.message ?: t("packRemoval.couldNotRemoveThePack"))
        }
        // a pack of a server I am in stays, just not installed
        if (p.serverId != null && Nexa.servers.get(p.serverId) != null) Nexa.expressions.upsertPack(p.copy(installed = false))
        else Nexa.expressions.removePack(p.id)
        Nexa.ui.toast(t("pickers.stickerPicker.removedNamed", "name" to p.name), "success")
    }
}

// ---- Discover ----

@Composable
private fun Discover(onEdit: (StickerPack) -> Unit) {
    val c = Nx.colors
    val me = Nexa.users.me.collectAsState().value?.id
    val packs by Nexa.expressions.packs.collectAsState()
    var q by remember { mutableStateOf("") }
    var list by remember { mutableStateOf<List<StickerPack>?>(null) }
    var installing by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(q) {
        if (q.isNotEmpty()) delay(300)
        list = null
        list = try {
            Nexa.api.get("/stickers/packs/public?q=${URLEncoder.encode(q.trim(), "UTF-8")}&limit=50", ListSerializer(StickerPack.serializer()))
        } catch (_: Exception) {
            emptyList()
        }
    }
    NxTextField(q, { q = it }, placeholder = t("settings.stickers.searchPublicPacks"), modifier = Modifier.semantics { contentDescription = t("settings.stickers.searchPublicPacks") })
    val l = list
    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            l == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Spinner() }
            l.isEmpty() -> EmptyBox(t(if (q.isNotBlank()) "settings.stickers.noPublicPacksMatch" else "settings.stickers.noPublicPacksYet"))
            else -> for (p in l) {
                val known = packs[p.id]
                val installed = known?.installed == true || p.installed
                val shape = Radii.Md
                Column(
                    Modifier
                        .fillMaxWidth()
                        .ring(shape, c.borderSubtle)
                        .background(c.bgSurface, shape)
                        .background(sheen(c), shape)
                        .topEdge(shape, c.edgeLight)
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(48.dp).sunken(Radii.Sm, c), contentAlignment = Alignment.Center) {
                            val cover = packCover(p)
                            if (cover != null) ItemImage(cover, isEmoji(p), 48.dp, Modifier.size(40.dp))
                            else Txt(p.name.take(1).uppercase(), style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textMuted)
                        }
                        Column(Modifier.weight(1f)) {
                            Txt(p.name, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                            Txt(packCount(p), style = Nx.type.hint, color = c.textMuted)
                        }
                        when {
                            p.ownerUserId == me -> NxButton(t("pickers.stickerPicker.edit"), { onEdit(p) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                            installed && canRemove(known ?: p.copy(installed = true), me) -> NxButton(t("composer.composer.remove"), { confirmRemovePack(known ?: p) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                            installed -> NxButton(t("settings.stickers.installed"), {}, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, enabled = false)
                            else -> NxButton(t("settings.stickers.install"), {
                                installing = p.id
                                scope.launch {
                                    try {
                                        Nexa.expressions.upsertPack(Nexa.api.request("PUT", "/stickers/packs/${p.id}/install", StickerPack.serializer()))
                                    } catch (e: Exception) {
                                        Nexa.ui.toast((e as? ApiError)?.message ?: t("modals.stickerPack.couldNotInstallThePack"), "error")
                                    } finally {
                                        installing = null
                                    }
                                }
                            }, size = ButtonSize.SM, loading = installing == p.id)
                        }
                    }
                    if (p.description.isNotBlank()) Txt(p.description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textMuted, maxLines = 3)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (s in p.stickers.sortedBy { it.position }.take(4)) ItemImage(s, isEmoji(p), 56.dp, Modifier.size(52.dp))
                    }
                }
            }
        }
    }
}
