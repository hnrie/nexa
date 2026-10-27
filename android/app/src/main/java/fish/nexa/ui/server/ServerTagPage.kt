package fish.nexa.ui.server

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.data.ServerState
import fish.nexa.media.Media
import fish.nexa.net.Server
import fish.nexa.net.ServerTag
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleLine
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.markdown.Zalgo
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** The colours on offer beside the accent; any other is the last swatch away. */
private val TAG_COLORS = listOf(0x5865f2L, 0x3d9e60L, 0xfdb833L, 0xda3e44L, 0xeb459fL, 0x1abc9cL, 0xe67e22L, 0x607d8bL, 0xffffffL)

/** The 30 badges, by the name stored and the lucide icon drawn. */
val TAG_ICONS = listOf(
    "leaf" to "Leaf", "flame" to "Flame", "heart" to "Heart", "star" to "Star", "sparkles" to "Sparkles", "zap" to "Zap",
    "moon" to "Moon", "sun" to "Sun", "snowflake" to "Snowflake", "droplet" to "Droplet", "cloud" to "Cloud", "rainbow" to "Rainbow",
    "skull" to "Skull", "ghost" to "Ghost", "crown" to "Crown", "gem" to "Gem", "swords" to "Swords", "shield" to "Shield",
    "cat" to "Cat", "dog" to "Dog", "bird" to "Bird", "fish" to "Fish", "rabbit" to "Rabbit", "paw-print" to "PawPrint",
    "rocket" to "Rocket", "music" to "Music", "gamepad-2" to "Gamepad2", "trophy" to "Trophy", "coffee" to "Coffee", "cherry" to "Cherry",
)

const val DEFAULT_TAG_BADGE = "icon:sparkles"
private const val MAX_TAG_LETTERS = 4
private const val SYMBOLS = "!?.-_+&#@$%*~^=:'"

/** lib/serverTags.ts readTagText: one to eight letters, numbers or symbols, no spaces, no zalgo. */
fun readTagText(raw: String): Pair<String, Boolean> {
    val text = raw.trim()
    var count = 0
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        val type = Character.getType(cp)
        when {
            Character.isLetterOrDigit(cp) -> count++
            type == Character.NON_SPACING_MARK.toInt() || type == Character.COMBINING_SPACING_MARK.toInt() -> if (count == 0) return text to false
            cp < 0x10000 && SYMBOLS.indexOf(cp.toChar()) >= 0 -> count++
            else -> return text to false
        }
        i += Character.charCount(cp)
    }
    val ok = count in 1..MAX_TAG_LETTERS && text.codePointCount(0, text.length) <= MAX_TAG_LETTERS * 4 && !Zalgo.has(text)
    return text to ok
}

/** canWearTag: the server has a tag, and it is open to all, or this account manages the server or holds a listed role. */
fun canWearTag(st: ServerState?): Boolean {
    val tag = st?.server?.tag ?: return false
    if (!tag.limited) return true
    if (P.has(st.myPermissions, P.MANAGE_SERVER)) return true
    return st.me.roleIds.any { it in tag.roles }
}

private data class TagDraft(val text: String, val badge: String, val color: Long?, val limited: Boolean, val roles: List<String>, val join: Boolean)

private fun draftOf(tag: ServerTag?) = TagDraft(tag?.text ?: "", tag?.badge ?: DEFAULT_TAG_BADGE, tag?.color, tag?.limited ?: false, tag?.roles ?: emptyList(), tag?.join ?: false)

/**
 * Server Settings, Server Tag: the letters, badge and colour members wear
 * beside their name, who may wear it, and whether pressing it lets people
 * join. The preview is the tag beside this account's own name.
 */
@Composable
fun ServerTagPage(serverId: String) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val me by Nexa.users.me.collectAsState()
    val st = servers[serverId] ?: return
    val saved = st.server.tag
    var draft by remember { mutableStateOf(draftOf(saved)) }
    // the server's own picture, kept as a choice while another badge is tried
    var picture by remember { mutableStateOf(saved?.badge?.takeIf { it.startsWith("image:") }) }
    var busy by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    val (letters, lettersOk) = readTagText(draft.text)
    val base = draftOf(saved)
    val dirty = draft != base
    val roles = Nexa.servers.rolesByPosition(st).filter { it.id != serverId }
    val lettersChange = saved != null && letters != saved.text

    fun save() {
        if (!lettersOk) {
            Nexa.ui.toast(t("serverTag.page.tagHint"), "error")
            return
        }
        busy = true
        scope.launch {
            try {
                val srv = Nexa.api.request("PUT", "/servers/$serverId/tag", Server.serializer(), buildJsonObject {
                    put("text", letters)
                    put("badge", draft.badge)
                    if (draft.color != null) put("color", draft.color) else put("color", JsonNull)
                    put("limited", draft.limited)
                    put("roles", JsonArray((if (draft.limited) draft.roles else emptyList()).map { JsonPrimitive(it) }))
                    put("join", draft.join)
                })
                Nexa.servers.setServer(srv)
                draft = draftOf(srv.tag)
                Nexa.ui.toast(t("serverTag.page.saved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("serverTag.page.couldNotSave")), "error")
            } finally {
                busy = false
            }
        }
    }

    fun remove() = confirm(t("serverTag.page.removeTitle"), t("serverTag.page.removeBody"), t("serverTag.page.remove")) {
        Nexa.api.request("DELETE", "/servers/$serverId/tag")
        Nexa.servers.get(serverId)?.server?.let { Nexa.servers.setServer(it.copy(tag = null)) }
        draft = draftOf(null)
        picture = null
        Nexa.ui.toast(t("serverTag.page.removed"), "success")
    }

    fun upload(r: CropResult) {
        uploading = true
        scope.launch {
            try {
                val area = r.crop?.let { "?x=${it.x}&y=${it.y}&w=${it.w}&h=${it.h}" } ?: ""
                val res = ServerApi.upload("POST", "/servers/$serverId/tag/badge$area", r.bytes, r.type).jsonObject
                val badge = (res["badge"] as? JsonPrimitive)?.content ?: return@launch
                picture = badge
                draft = draft.copy(badge = badge)
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("serverTag.page.uploadFailed")), "error")
            } finally {
                uploading = false
            }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val f = runCatching { ServerApi.read(context, uri) }.getOrNull() ?: return@launch
            openImageCrop(f, 1f, round = false, title = t("serverTag.page.cropTitle"), maxSize = 96, serverCrop = true) { upload(it) }
        }
    }
    fun choosePicture() = pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

    val tagColor = draft.color?.let { rgbColor(it) } ?: c.brand
    SettingsPage(SaveState(dirty, busy, { draft = base }, ::save)) {
        PageTitle(t("serverTag.page.title"), Modifier.padding(bottom = 0.dp))
        Hint(t("serverTag.page.intro"), Modifier.padding(bottom = 22.dp))
        Form {
            NxTextField(
                draft.text, { v -> draft = draft.copy(text = v.replace(Regex("\\s"), "").take(MAX_TAG_LETTERS * 4)) },
                label = t("serverTag.page.tagLabel"),
                placeholder = t("serverTag.page.tagPlaceholder"),
                hint = if (lettersChange) t("serverTag.page.lettersChange") else t("serverTag.page.tagHint"),
                error = if (draft.text.isNotEmpty() && !lettersOk) t("serverTag.page.tagHint") else null,
            )
            Column {
                H5(t("serverTag.page.badge"), top = 0.dp)
                BadgeGrid(Modifier.widthIn(max = 460.dp)) {
                    val on = picture != null && draft.badge == picture
                    BadgeTile(on, if (picture != null) t("serverTag.page.yourPicture") else t("serverTag.page.upload"), tagColor, upload = true, enabled = !uploading, {
                        val p = picture
                        if (p != null && draft.badge != p) draft = draft.copy(badge = p) else choosePicture()
                    }) {
                        val p = picture
                        if (p != null) TagPicture(p, Modifier.fillMaxSize(0.7f).clip(RoundedCornerShape(6.dp)))
                        else Icon("ImagePlus", c.icon, size = 20.dp)
                    }
                    TAG_ICONS.forEachIndexed { i, (name, lucide) ->
                        val badge = "icon:$name"
                        val chosen = draft.badge == badge
                        BadgeTile(chosen, t("serverTag.page.badgeIndex", "index" to i + 1, "count" to TAG_ICONS.size), tagColor, upload = false, enabled = true, { draft = draft.copy(badge = badge) }) {
                            Icon(lucide, if (chosen) mixOklab(tagColor, c.textStrong, 0.3f) else c.icon, size = 20.dp)
                        }
                    }
                }
                Wrap(Modifier.padding(top = 4.dp), gap = 4.dp) {
                    Hint(t("serverTag.page.uploadHint"), top = 0.dp)
                    if (picture != null) NxButton(t("serverTag.page.changePicture"), { choosePicture() }, kind = ButtonKind.LINK, inline = true)
                }
            }
            Column {
                H5(t("serverTag.page.color"), top = 0.dp)
                Wrap(gap = 10.dp) {
                    Swatch(c.brand, draft.color == null, t("serverTag.page.accent"), true) { draft = draft.copy(color = null) }
                    TAG_COLORS.forEachIndexed { i, col ->
                        Swatch(rgbColor(col), draft.color == col, t("server.roles.colourIndexOfCount", "index" to i + 1, "count" to TAG_COLORS.size), true) { draft = draft.copy(color = col) }
                    }
                    val custom = draft.color?.takeIf { it !in TAG_COLORS }
                    CustomSwatch(custom, true) { openColourPick(t("server.roles.customColour"), draft.color ?: 0x8000ffL) { picked -> draft = draft.copy(color = picked) } }
                }
            }
            Column {
                H5(t("serverTag.page.who"), top = 0.dp)
                RadioCard(t("serverTag.page.everyone"), !draft.limited, { draft = draft.copy(limited = false) })
                RadioCard(t("serverTag.page.someRoles"), draft.limited, { draft = draft.copy(limited = true) }, description = t("serverTag.page.someRolesHint"))
                if (draft.limited) {
                    if (roles.isEmpty()) Hint(t("serverTag.page.noRoles"))
                    else Wrap(Modifier.padding(top = 4.dp), gap = 6.dp) {
                        for (r in roles) {
                            val on = r.id in draft.roles
                            RoleToggleChip(r.name, r.color, on) { draft = draft.copy(roles = if (on) draft.roles - r.id else draft.roles + r.id) }
                        }
                    }
                }
            }
            ToggleLine(t("serverTag.page.join"), draft.join, { draft = draft.copy(join = it) }, description = t("serverTag.page.joinHint"))
            if (saved != null) Box {
                NxButton(t("serverTag.page.remove"), { remove() }, kind = ButtonKind.DANGER, size = ButtonSize.SM, icon = "Trash2")
            }
            // the preview: a message, a member list row and the tag on its own
            Column {
                H5(t("serverTag.page.preview"), top = 0.dp)
                val shape = Radii.Lg
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(mixOklab(c.bgBase, c.bgRaised, 0.45f), shape)
                        .ring(shape, c.borderSubtle)
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    val u = me
                    val name = u?.name ?: ""
                    val chipText = letters.ifEmpty { "TAG" }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Avatar(u?.id ?: "", name, u?.avatarId, 36.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                fish.nexa.ui.chat.PersonName(u?.id, name, nameStyle = u?.nameStyle, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                                TagChip(chipText, draft.badge, draft.color, TagSize.MD)
                            }
                            Txt(t("serverTag.page.previewMessage"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(19.6f)), color = c.text)
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().background(c.bgHover, Radii.Sm).padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Avatar(u?.id ?: "", name, u?.avatarId, 32.dp, status = "online")
                        fish.nexa.ui.chat.PersonName(u?.id, name, nameStyle = u?.nameStyle, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                        TagChip(chipText, draft.badge, draft.color, TagSize.SM)
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TagChip(chipText, draft.badge, draft.color, TagSize.LG) }
                }
            }
        }
    }
}

/** `.badges`: tiles at least 42 dp wide, 8 dp apart, square. */
@Composable
private fun BadgeGrid(modifier: Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier.fillMaxWidth()) { measurables, constraints ->
        val gap = 8.dp.roundToPx()
        val min = 42.dp.roundToPx()
        val width = constraints.maxWidth
        val cols = maxOf(1, (width + gap) / (min + gap))
        val tile = (width - gap * (cols - 1)) / cols
        val placeables = measurables.map { it.measure(Constraints.fixed(tile, tile)) }
        val rows = (placeables.size + cols - 1) / cols
        layout(width, rows * tile + maxOf(0, rows - 1) * gap) {
            placeables.forEachIndexed { i, p -> p.placeRelative((i % cols) * (tile + gap), (i / cols) * (tile + gap)) }
        }
    }
}

/** A badge tile; chosen, tinted and ringed in the tag's own colour. */
@Composable
private fun BadgeTile(on: Boolean, label: String, tag: Color, upload: Boolean, enabled: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Sm
    Box(
        Modifier
            .aspectRatio(1f)
            .then(
                when {
                    on -> Modifier.ring(shape, tag, 2.dp).background(mixOklab(c.bgSurface, tag, 0.18f), shape).background(sheen(c), shape).topEdge(shape, c.edgeLight)
                    upload -> Modifier.border(1.5.dp, c.border, shape)
                    else -> Modifier.surfaceCard(c, shape)
                },
            )
            .clip(shape)
            .alpha(if (enabled) 1f else 0.6f)
            .pressable(remember { MutableInteractionSource() }, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics {
                selected = on
                contentDescription = label
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** `.role` in the tag's role list: a pill with the role's dot; chosen, ringed in the accent. */
@Composable
private fun RoleToggleChip(name: String, color: Long, on: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Pill
    Row(
        Modifier
            .heightIn(min = 36.dp)
            .then(
                if (on) Modifier.ring(shape, c.brand.copy(alpha = 0.8f), 2.dp).background(mixSrgb(c.bgSurface, c.brand, 0.16f), shape).background(sheen(c), shape)
                else Modifier.surfaceCard(c, shape),
            )
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, role = Role.Checkbox, onClick = onClick)
            .semantics { selected = on }
            .padding(start = 9.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ColorDot(color, 10.dp)
        Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.textSubtle, maxLines = 1)
    }
}

@Composable
private fun TagPicture(badge: String, modifier: Modifier) {
    val density = LocalDensity.current.density
    val id = Regex("^image:(\\d{1,20})$").find(badge)?.groupValues?.get(1) ?: return
    AsyncImage(Media.tagUrl(id, 32, density), null, Media.loader, modifier, contentScale = ContentScale.Crop)
}

enum class TagSize(val height: Dp, val radius: Dp, val padStart: Dp, val padEnd: Dp, val gap: Dp, val font: Float) {
    SM(16.dp, 5.dp, 3.dp, 5.dp, 3.dp, 10.5f),
    MD(18.dp, 6.dp, 4.dp, 6.dp, 3.dp, 11f),
    LG(24.dp, 8.dp, 6.dp, 9.dp, 5.dp, 13.5f),
}

/** The tag chip (ServerTagChip) as the preview draws it: the badge and the letters in the tag's colour. */
@Composable
fun TagChip(text: String, badge: String, color: Long?, size: TagSize) {
    val c = Nx.colors
    val tag = color?.let { rgbColor(it) } ?: c.brand
    val shape = RoundedCornerShape(size.radius)
    Row(
        Modifier
            .height(size.height)
            .background(tag.copy(alpha = 0.20f), shape)
            .ring(shape, tag.copy(alpha = 0.42f))
            .padding(start = size.padStart, end = size.padEnd)
            .semantics { contentDescription = t("serverTag.chipLabel", "tag" to text) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(size.gap),
    ) {
        val square = size.height - 6.dp
        val icon = TAG_ICONS.firstOrNull { "icon:${it.first}" == badge }?.second
        when {
            badge.startsWith("image:") -> TagPicture(badge, Modifier.size(square).clip(RoundedCornerShape(3.dp)))
            else -> Icon(icon ?: "Sparkles", mixSrgb(tag, c.textStrong, 0.18f), size = square, stroke = 2.4f)
        }
        Txt(text, style = Nx.type.label.copy(fontSize = Nx.type.sp(size.font), fontWeight = FontWeight(700)), color = mixSrgb(tag, c.textStrong, 0.40f), maxLines = 1)
    }
}
