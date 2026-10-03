package fish.nexa.ui.server

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.shell.ChannelTree
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** What someone changed on one webhook and has not saved; a picture is its PNG, or REMOVED to take it away. */
private class Draft(val name: String? = null, val channel: String? = null, val avatar: ByteArray? = null, val removeAvatar: Boolean = false) {
    fun with(name: String? = this.name, channel: String? = this.channel, avatar: ByteArray? = this.avatar, removeAvatar: Boolean = this.removeAvatar) = Draft(name, channel, avatar, removeAvatar)
}

/** A name for a new webhook that none of the others has yet: "Webhook", "Webhook 2", ... */
fun freshName(base: String, taken: List<String>): String {
    val used = taken.map { it.lowercase() }.toSet()
    if (base.lowercase() !in used) return base
    var i = 2
    while ("$base $i".lowercase() in used) i++
    return "$base $i"
}

/** Copies [text] and says so in the words given. */
fun copyAndSay(text: String, said: String) {
    val cm = Nexa.app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    cm.setPrimaryClip(android.content.ClipData.newPlainText("Nexa", text))
    Nexa.ui.toast(said, "success")
}

/**
 * IntegrationsPage: the server's webhooks, or with [channelId] only that
 * channel's (Channel Settings). Each can be named, given a picture, moved,
 * have its URL copied, or be deleted; only channels where this account may
 * manage webhooks are offered.
 */
@Composable
fun IntegrationsPage(serverId: String, channelId: String?) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val st = servers[serverId] ?: return
    var list by remember { mutableStateOf<List<Webhook>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val drafts = remember { mutableStateMapOf<String, Draft>() }
    var open by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    // the text channels this account may put a webhook in
    val targets = remember(channels, st) {
        val tree = ChannelTree.of(serverId, channels.values)
        (tree.loose + tree.categories.flatMap { it.children }).filter { it.isText && Nexa.servers.canI(st, P.MANAGE_WEBHOOKS, it.id) }
    }

    suspend fun load() {
        try {
            val path = if (channelId != null) "/channels/$channelId/webhooks" else "/servers/$serverId/webhooks"
            list = Nexa.api.get(path, ListSerializer(Webhook.serializer()))
            failed = false
        } catch (_: Exception) {
            list = null
            failed = true
        }
    }
    LaunchedEffect(attempt) { load() }
    LaunchedEffect(Unit) {
        Nexa.session.events.collect { e ->
            if (e.t == "webhooks_update" && ((e.d as? JsonObject)?.get("server_id") as? JsonPrimitive)?.contentOrNull == serverId) load()
        }
    }

    fun create() {
        val target = channelId ?: targets.firstOrNull()?.id ?: return
        creating = true
        scope.launch {
            try {
                val made = Nexa.api.request("POST", "/channels/$target/webhooks", Webhook.serializer(), buildJsonObject {
                    put("name", freshName(t("integrations.defaultName"), list.orEmpty().map { it.name }))
                })
                list = list.orEmpty() + made
                open = made.id
                Nexa.ui.toast(t("integrations.created", "name" to made.name), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("integrations.couldNotCreate")), "error")
            } finally {
                creating = false
            }
        }
    }

    val dirtyIds = drafts.keys.filter { id ->
        val d = drafts[id] ?: return@filter false
        val w = list?.firstOrNull { it.id == id } ?: return@filter false
        (d.name != null && d.name.trim() != w.name) || (d.channel != null && d.channel != w.channelId) || d.avatar != null || d.removeAvatar
    }

    fun save() {
        if (dirtyIds.any { (drafts[it]?.name ?: "x").isBlank() }) {
            Nexa.ui.toast(t("integrations.nameRequired"), "error")
            return
        }
        busy = true
        scope.launch {
            try {
                for (id in dirtyIds) {
                    val d = drafts[id] ?: continue
                    val w = list?.firstOrNull { it.id == id } ?: continue
                    val patch = buildJsonObject {
                        if (d.name != null && d.name.trim() != w.name) put("name", d.name.trim())
                        if (d.channel != null && d.channel != w.channelId) put("channel_id", d.channel)
                        if (d.avatar != null) put("avatar", "data:image/png;base64," + Base64.encodeToString(d.avatar, Base64.NO_WRAP))
                        else if (d.removeAvatar) put("avatar", JsonNull)
                    }
                    val updated = Nexa.api.request("PATCH", "/webhooks/$id", Webhook.serializer(), patch)
                    // one moved out of the channel on show here goes from the list
                    list = if (channelId != null && updated.channelId != channelId) list.orEmpty().filter { it.id != id } else list.orEmpty().map { if (it.id == id) updated else it }
                    drafts.remove(id)
                }
                Nexa.ui.toast(t("integrations.saved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("integrations.couldNotSave")), "error")
            } finally {
                busy = false
            }
        }
    }

    fun remove(w: Webhook) = confirm(t("integrations.deleteTitle", "name" to w.name), t("integrations.deleteBody"), t("integrations.deleteWebhook")) {
        Nexa.api.request("DELETE", "/webhooks/${w.id}")
        list = list.orEmpty().filter { it.id != w.id }
        drafts.remove(w.id)
    }

    var pickFor by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        val id = pickFor
        if (uri == null || id == null) return@rememberLauncherForActivityResult
        scope.launch {
            val f = runCatching { ServerApi.read(context, uri) }.getOrNull() ?: return@launch
            openImageCrop(f, 1f, round = true, title = t("integrations.cropImage"), maxSize = 512) { r ->
                // the web sends the cropped picture as a PNG; an animation kept whole goes as it is
                drafts[id] = (drafts[id] ?: Draft()).with(avatar = r.bytes, removeAvatar = false)
            }
        }
    }

    val canCreate = if (channelId != null) targets.any { it.id == channelId } else targets.isNotEmpty()
    SettingsPage(SaveState(dirtyIds.isNotEmpty(), busy, { drafts.clear() }, ::save)) {
        PageTitle(t("integrations.title"), Modifier.padding(bottom = 0.dp))
        Hint(t("integrations.intro"))
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp).background(c.bgSurface, Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon("LockOpen", c.textMuted, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
            Txt(t("integrations.notEncrypted"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(18f)), color = c.textSubtle, modifier = Modifier.weight(1f))
        }
        H5(t("integrations.webhooks"))
        Box(Modifier.padding(top = 4.dp, bottom = 12.dp)) {
            NxButton(t("integrations.newWebhook"), { create() }, size = ButtonSize.SM, icon = "Plus", loading = creating, enabled = canCreate)
        }
        when {
            list == null && !failed -> Loading(t("integrations.loading"))
            failed -> LoadFailed(t("integrations.couldNotLoad")) { attempt++ }
            list?.isEmpty() == true -> Column(
                Modifier.fillMaxWidth().dashedOutline(c.border, Radii.sm, 1.dp).padding(horizontal = 16.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("Webhook", c.textMuted, size = 28.dp)
                Txt(t("integrations.none"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (w in list.orEmpty()) key(w.id) {
                val d = drafts[w.id] ?: Draft()
                val expanded = open == w.id
                val name = d.name ?: w.name
                val channel = d.channel ?: w.channelId
                val creator = w.user?.let { u -> users[u.id]?.name ?: u.displayName.ifBlank { u.username } }
                val preview = remember(d.avatar) { d.avatar?.let { b -> runCatching { BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap() }.getOrNull() } }
                val avatarId = if (d.removeAvatar) null else w.avatar
                Column(Modifier.fillMaxWidth().border(1.dp, c.borderSubtle, Radii.Sm).background(c.bgSurface, Radii.Sm).clip(Radii.Sm)) {
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(if (pressed) c.bgHover else Color.Transparent)
                            .pressable(interaction) { open = if (expanded) null else w.id }
                            .semantics { stateDescription = if (expanded) "expanded" else "collapsed" }
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        HookAvatar(w.id, name, avatarId, preview, 40.dp)
                        Column(Modifier.weight(1f)) {
                            Txt(name, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                            val where = channels[w.channelId]?.let { "#${it.name} · " } ?: ""
                            val made = if (creator != null) t("integrations.createdBy", "date" to Time.shortDate(w.createdAt), "name" to creator) else t("integrations.createdOn", "date" to Time.shortDate(w.createdAt))
                            Txt(where + made, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                        }
                        Icon(if (expanded) "ChevronDown" else "ChevronRight", c.textMuted, size = 18.dp)
                    }
                    if (expanded) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Wrap {
                                HookAvatar(w.id, name, avatarId, preview, 80.dp)
                                NxButton(t("integrations.uploadImage"), {
                                    pickFor = w.id
                                    pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                                if ((w.avatar != null && !d.removeAvatar) || d.avatar != null) NxButton(t("integrations.removeImage"), {
                                    // undo a picture staged here, or take the saved one away
                                    drafts[w.id] = if (d.avatar != null) d.with(avatar = null) else d.with(removeAvatar = w.avatar != null)
                                }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
                            }
                            NxTextField(name, { v -> drafts[w.id] = d.with(name = v.take(80)) }, label = t("integrations.name"), required = true, capitalize = true)
                            if (channelId == null) Field(t("integrations.channel")) {
                                val options = buildList {
                                    if (targets.none { it.id == channel }) channels[channel]?.let { add(it.id to "#${it.name}") }
                                    targets.forEach { add(it.id to "#${it.name}") }
                                }
                                SelectField(options, channel, { v -> drafts[w.id] = d.with(channel = v) }, title = t("integrations.channel"))
                            }
                            Wrap {
                                NxButton(t("integrations.copyUrl"), { w.url?.let { copyAndSay(it, t("integrations.urlCopied")) } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Copy", enabled = w.url != null)
                                NxButton(t("integrations.deleteWebhook"), { remove(w) }, kind = ButtonKind.DANGER, size = ButtonSize.SM, icon = "Trash2")
                            }
                            Txt(t("integrations.formatsTip"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17f)), color = c.textMuted)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HookAvatar(id: String, name: String, avatarId: String?, preview: ImageBitmap?, size: Dp) {
    if (preview != null) Image(preview, null, Modifier.size(size).clip(CircleShape), contentScale = ContentScale.Crop)
    else Avatar(id, name, avatarId, size)
}
