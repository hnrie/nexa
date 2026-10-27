package fish.nexa.ui.dialogs

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.Invites
import fish.nexa.media.Media
import fish.nexa.net.Channel
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.AvatarColor
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.SelectField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.profile.copyWithToast
import fish.nexa.ui.profile.dmOpenError
import fish.nexa.ui.shell.DmArrange
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowMedium
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** Sends a picture's bytes as the body of a request (api.upload), and reads the answer. */
internal suspend fun uploadPicture(method: String, path: String, uri: Uri): JsonElement {
    val resolver = Nexa.app.contentResolver
    val type = resolver.getType(uri) ?: "application/octet-stream"
    val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } } ?: throw IllegalStateException()
    val req = Nexa.api.requestBuilder(path).method(method, bytes.toRequestBody(type.toMediaType())).build()
    return Nexa.api.execute(Nexa.api.http, req, true)
}

/**
 * IconPicker: a round (or squircle) well with a dashed edge that opens the
 * photo picker; the picture picked (or the current one) fills it, with an x
 * to take it away. Someone who may not change it sees it plain.
 */
@Composable
internal fun IconPicker(currentUrl: String?, picked: Uri?, onPick: (Uri) -> Unit, onRemove: (() -> Unit)?, initials: String, label: String, enabled: Boolean = true, square: Boolean = false) {
    val c = Nx.colors
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) onPick(uri) }
    val shown: Any? = picked ?: currentUrl
    val shape = if (square) RoundedCornerShape(24.dp) else CircleShape
    val dash = mixSrgb(c.borderStrong, c.brand, 0.45f)
    Box(Modifier.size(80.dp)) {
        Box(
            Modifier
                .size(80.dp)
                .clip(shape)
                .background(Brush.radialGradient(listOf(mixSrgb(c.bgActive, c.brand, 0.16f), c.bgActive)))
                .drawBehind {
                    val w = 2.dp.toPx()
                    val effect = if (enabled) PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())) else null
                    if (square) drawRoundRect(dash, cornerRadius = CornerRadius(24.dp.toPx()), style = Stroke(w, pathEffect = effect))
                    else drawCircle(dash, radius = size.minDimension / 2 - w / 2, style = Stroke(w, pathEffect = effect))
                }
                .then(if (enabled) Modifier.pressable(remember { MutableInteractionSource() }) { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) } else Modifier)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            when {
                shown != null -> AsyncImage(shown, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                enabled -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Icon("ImagePlus", c.textMuted, size = 20.dp)
                    Txt(t("common.iconPicker.upload"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f), fontWeight = FontWeight(700)), color = c.textMuted)
                }
                else -> Txt(initials, style = Nx.type.name.copy(fontSize = Nx.type.sp(26f), fontWeight = FontWeight(700)), color = c.textStrong)
            }
        }
        if (shown != null && onRemove != null && enabled) Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(2.dp, (-2).dp)
                .size(28.dp)
                .shadowMedium(CircleShape, c)
                .background(c.bgFloating, CircleShape)
                .clip(CircleShape)
                .pressable(remember { MutableInteractionSource() }, onClick = onRemove)
                .semantics { contentDescription = t("common.iconPicker.removeIcon") },
            contentAlignment = Alignment.Center,
        ) { Icon("X", c.text, size = 14.dp) }
    }
}

// ---------------------------------------------------------------------------
// EditGroupModal: a group's name and (for its owner) its icon

@Composable
internal fun EditGroupSheet(layer: Layer, channelId: String, close: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val channels by Nexa.channels.byId.collectAsState()
    val ch = channels[channelId]?.takeIf { it.type == "group_dm" } ?: return
    val density = LocalDensity.current.density
    var name by remember { mutableStateOf(ch.name) }
    var icon by remember { mutableStateOf<Uri?>(null) }
    var removeIcon by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val owner = DmArrange.managesGroup(ch)
    val current = if (removeIcon) null else ch.iconId?.let { Media.iconUrl(it, 80, density) }
    val shownName = name.trim().ifEmpty { Names.channel(ch) }
    val dirty = name.trim() != ch.name || icon != null || removeIcon
    fun save() {
        if (!dirty || busy) return
        busy = true
        scope.launch {
            try {
                var next: Channel = ch
                if (name.trim() != ch.name) next = Nexa.api.request("PATCH", "/channels/${ch.id}", Channel.serializer(), buildJsonObject { put("name", name.trim()) })
                val picked = icon
                if (picked != null) next = wireJson.decodeFromJsonElement(Channel.serializer(), uploadPicture("PUT", "/channels/${ch.id}/icon", picked))
                else if (removeIcon && ch.iconId != null) {
                    Nexa.api.request("DELETE", "/channels/${ch.id}/icon")
                    next = next.copy(iconId = null)
                }
                Nexa.channels.upsert(listOf(next))
                close()
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("modals.editGroup.couldNotSaveTheGroup")), "error")
            } finally {
                busy = false
            }
        }
    }
    Sheet(layer, title = t("modals.editGroup.editGroup"), maxWidth = 440.dp, footer = {
        FooterButtons(t("chat.editMessage.save"), ::save, close, enabled = dirty, busy = busy)
    }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            IconPicker(
                current, icon,
                onPick = {
                    icon = it
                    removeIcon = false
                },
                onRemove = {
                    icon = null
                    removeIcon = true
                },
                initials = AvatarColor.initials(shownName),
                label = t("modals.editGroup.groupIcon"),
                enabled = owner,
            )
            DialogHint(if (owner) t("modals.editGroup.pickAPictureForTheGroup") else t("modals.editGroup.onlyTheGroupSOwnerCan"))
        }
        NxTextField(
            name, { name = it.take(100) },
            label = t("modals.editGroup.groupName"),
            placeholder = Names.channel(ch.copy(name = "")),
            imeAction = ImeAction.Done,
            onIme = ::save,
            capitalize = true,
        )
    }
}

// ---------------------------------------------------------------------------
// GroupInviteModal: friends added straight from the list, or a link

private fun groupAges() = listOf(
    1800 to t("modals.customStatus.30Minutes"),
    86400 to t("modals.groupInvite.1Day"),
    604800 to t("modals.groupInvite.7Days"),
    0 to t("modals.groupInvite.never"),
)

private val GROUP_USES = listOf(0, 1, 5, 10, 25)

@Composable
internal fun GroupInviteSheet(layer: Layer, channelId: String, close: () -> Unit) {
    val c = Nx.colors
    val channels by Nexa.channels.byId.collectAsState()
    val ch = channels[channelId] ?: return
    var age by remember { mutableIntStateOf(604800) }
    var uses by remember { mutableIntStateOf(0) }
    var invite by remember { mutableStateOf<Invites.Made?>(null) }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var seq by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val key = Invites.keyOf(channelId)
    fun generate(a: Int, u: Int) {
        val n = ++seq
        busy = true
        scope.launch {
            try {
                val made = Invites.create(channelId, a, u)
                if (n == seq) invite = made
            } catch (e: Exception) {
                if (n == seq) Nexa.ui.toast(describeError(e, t("modals.groupInvite.couldNotCreateAnInvite")), "error")
            } finally {
                if (n == seq) busy = false
            }
        }
    }
    LaunchedEffect(Unit) { generate(age, uses) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    val made = invite
    val link = made?.let { Invites.url(it.code, key) } ?: ""
    // a join request carries the link shown here, once there is one
    val requests = remember(channelId) {
        JoinRequests(channelId) {
            invite?.let { Invites.url(it.code, Invites.keyOf(channelId)) } ?: Invites.url(Invites.create(channelId, age, uses).code, Invites.keyOf(channelId))
        }
    }
    Sheet(layer, title = t("modals.groupInvite.invitePeopleTo", "name" to Names.channel(ch)), maxWidth = 480.dp) {
        GroupFriendAdder(ch, requests)
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        DialogHint(t("modals.groupInvite.anyoneWithThisLinkJoinsThe"))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("modals.createServer.inviteLink"), style = Nx.type.label, color = c.textSubtle)
            LinkRow(link, busy, copied) {
                copyWithToast(link, t("clipboard.copied"))
                copied = true
            }
            Txt(made?.expiresAt?.let { t("modals.groupInvite.expiresOn", "when" to Time.full(it)) } ?: t("modals.groupInvite.thisLinkNeverExpires"), style = Nx.type.hint, color = c.textMuted)
        }
        Row(
            Modifier.fillMaxWidth().ring(Radii.Sm, c.borderSubtle).background(mixOklab(c.bgFloating, c.bgBase, 0.6f), Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("KeyRound", if (key == null) c.warning else c.positive, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
            Txt(if (key != null) t("modals.groupInvite.theLinkCarriesThisChatS") else t("modals.groupInvite.youDoNotHoldThisChat"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.textMuted)
        }
        SelectField(t("modals.groupInvite.expireAfter"), groupAges(), age) {
            age = it
            generate(it, uses)
        }
        SelectField(t("modals.groupInvite.maxNumberOfUses"), GROUP_USES.map { it to if (it == 0) t("modals.groupInvite.noLimit") else t("modals.groupInvite.usesCount", "count" to it) }, uses) {
            uses = it
            generate(age, it)
        }
    }
}

/**
 * GroupFriendAdder: your friends who are not in the group yet, each with
 * Add, or (for a friend who joins groups only from a link) Send Join
 * Request. Someone added stays in the list, marked Added, until it closes.
 */
@Composable
private fun GroupFriendAdder(ch: Channel, requests: JoinRequests) {
    val c = Nx.colors
    val rels by Nexa.relationships.byId.collectAsState()
    var query by remember { mutableStateOf("") }
    val added = remember { mutableStateListOf<String>() }
    val busy = remember { mutableStateListOf<String>() }
    val scope = rememberCoroutineScope()
    val members = ch.recipientIds.filter { it !in added }.toSet()
    val all = remember(rels, members) { friendsByName().filter { it.id !in members } }
    val q = query.trim().lowercase().removePrefix("@")
    val shown = if (q.isEmpty()) all else all.filter { it.username.lowercase().contains(q) || it.displayName.lowercase().contains(q) || (Nexa.relationships.nickname(it.id)?.lowercase()?.contains(q) == true) }
    val anyFriends = rels.values.any { it.type == "friend" }
    fun add(user: PublicUser, name: String) {
        if (user.id in busy || user.id in added) return
        busy += user.id
        scope.launch {
            try {
                val next = Nexa.api.request("POST", "/channels/${ch.id}/recipients/${user.id}", Channel.serializer())
                Nexa.channels.upsert(listOf(next))
                added += user.id
            } catch (e: Exception) {
                Nexa.ui.toast(dmOpenError(e, t("modals.groupInvite.couldNotAddName", "name" to name)), "error")
            } finally {
                busy.remove(user.id)
            }
        }
    }
    val empty = when {
        !anyFriends -> t("modals.groupInvite.noFriendsYet")
        all.isEmpty() -> t("modals.groupInvite.allFriendsHere")
        shown.isEmpty() -> t("modals.createDM.noFriendsMatch")
        else -> null
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt(t("chat.chat.addFriends"), style = Nx.type.label, color = c.textSubtle)
        if (all.isNotEmpty()) NxTextField(query, { query = it }, placeholder = t("modals.groupInvite.searchFriends"), imeAction = ImeAction.Search)
        if (empty != null) Txt(empty, style = Nx.type.bodySmall, color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (u in shown.take(50)) {
                val name = Nexa.relationships.nickname(u.id) ?: Names.display(u)
                val done = u.id in added
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(u.id, name, u.avatarId, 32.dp)
                    fish.nexa.ui.chat.PersonName(u.id, name, nameStyle = u.nameStyle, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f))
                    if ((u.groupLinkOnly || requests.stateOf(u.id) == "sent") && !done) JoinRequestButton(name, requests.stateOf(u.id)) { requests.send(u.id, name) }
                    else NxButton(
                        if (done) t("modals.groupInvite.added") else t("modals.groupInvite.add"),
                        { if (!done) add(u, name) },
                        kind = if (done) ButtonKind.GHOST else ButtonKind.SECONDARY,
                        size = ButtonSize.SM,
                        icon = if (done) "Check" else null,
                        loading = u.id in busy,
                    )
                }
            }
        }
    }
}
