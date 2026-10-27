package fish.nexa.ui.server

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.media.Media
import fish.nexa.net.Emoji
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val EMOJI_TYPES = arrayOf("image/png", "image/gif", "image/webp", "image/jpeg")

/** An emoji's name from its file's: letters, numbers and underscores, 32 at most. */
fun emojiSlug(name: String): String =
    name.replace(Regex("\\.[a-z0-9]+$", RegexOption.IGNORE_CASE), "").replace(Regex("[^A-Za-z0-9_]+"), "_").trim('_').take(32).ifEmpty { "emoji" }

/** Server Settings, Emoji: upload still or moving emoji (no cap), rename and delete them. Managing needs Manage Expressions. */
@Composable
fun EmojiPage(serverId: String) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val all by Nexa.expressions.emojis.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val emojis = all[serverId].orEmpty()
    val manage = Nexa.servers.canI(servers[serverId], P.MANAGE_EMOJIS)
    var busy by remember { mutableStateOf(false) }
    var q by remember { mutableStateOf("") }

    suspend fun reload() {
        Nexa.expressions.setServerEmojis(serverId, Nexa.api.get("/servers/$serverId/emojis", ListSerializer(Emoji.serializer())))
    }

    fun upload(uris: List<android.net.Uri>) {
        busy = true
        scope.launch {
            var added = 0
            // names given earlier in this batch count as taken too, so party.gif and party.png don't collide
            val used = emojis.map { it.name }.toMutableSet()
            try {
                for (u in uris) {
                    val f = runCatching { ServerApi.read(context, u) }.getOrNull() ?: continue
                    if (f.type !in EMOJI_TYPES) {
                        Nexa.ui.toast(t("server.emoji.mustBeAnImage", "name" to f.name), "error")
                        continue
                    }
                    if (f.bytes.size > 2 * 1024 * 1024) {
                        Nexa.ui.toast(t("server.emoji.isLargerThan2Mb", "name" to f.name), "error")
                        continue
                    }
                    var name = emojiSlug(f.name)
                    var i = 2
                    while (name in used) name = "${emojiSlug(f.name).take(29)}_${i++}"
                    used += name
                    try {
                        ServerApi.upload("POST", "/servers/$serverId/emojis?name=${ServerApi.enc(name)}", f.bytes, f.type)
                        added++
                    } catch (e: Exception) {
                        Nexa.ui.toast("${f.name}: " + describeError(e, t("server.emoji.uploadFailedFor", "name" to f.name)), "error")
                    }
                }
                reload()
                if (added > 0) Nexa.ui.toast(t("server.emoji.emojiAddedCount", "count" to added), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.emoji.theEmojiListCouldNotBe")), "error")
            } finally {
                busy = false
            }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) upload(uris) }

    fun rename(e: Emoji) = promptText(
        t("server.emoji.renameEmoji"),
        PromptField("name", t("server.emoji.emojiName"), e.name, hint = t("server.emoji.lettersNumbersAndUnderscores"), maxLength = 32),
        t("server.packEditor.rename"),
    ) { next ->
        if (next.trim() == e.name) return@promptText
        scope.launch {
            try {
                Nexa.api.request("PATCH", "/servers/$serverId/emojis/${e.id}", buildJsonObject { put("name", next.trim()) })
                reload()
            } catch (err: Exception) {
                Nexa.ui.toast(describeError(err, t("server.packEditor.couldNotRename")), "error")
            }
        }
    }

    fun remove(e: Emoji) = confirm(t("server.emoji.deleteNamed", "name" to e.name), t("server.emoji.messagesThatUsedItWillShow"), t("server.emoji.deleteEmoji")) {
        Nexa.api.request("DELETE", "/servers/$serverId/emojis/${e.id}")
        reload()
    }

    val query = q.trim().lowercase().removePrefix(":").removeSuffix(":")
    val found = if (query.isEmpty()) emojis else emojis.filter { it.name.lowercase().contains(query) }
    SettingsPage {
        PageTitle(t("modals.customStatus.emoji"), Modifier.padding(bottom = 0.dp))
        Hint(t("server.emoji.addUpToAsManyEmoji"))
        if (manage) DropZone(if (busy) t("server.emoji.uploading") else t("server.emoji.tapToUpload")) { pick.launch(EMOJI_TYPES) }
        if (emojis.isEmpty()) Hint(t("server.emoji.noCustomEmojiYet"), top = 16.dp)
        else SearchBox(q, { q = it }, t("server.emoji.searchEmoji"), Modifier.padding(top = 16.dp, bottom = 4.dp))
        if (emojis.isNotEmpty() && found.isEmpty()) NoMatches(q, { q = "" })
        for ((label, list) in listOf(t("server.emoji.emoji") to found.filter { !it.animated }, t("server.emoji.animatedEmoji") to found.filter { it.animated })) {
            if (list.isEmpty()) continue
            H5(t("server.emoji.sectionCount", "label" to label, "count" to list.size))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (e in list) key(e.id) { EmojiRow(e, Names.display(users[e.creatorId]), manage, { rename(e) }, { remove(e) }) }
            }
        }
        if (manage) Box(Modifier.padding(top = 16.dp)) {
            NxButton(t("server.emoji.uploadEmoji"), { pick.launch(EMOJI_TYPES) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, loading = busy)
        }
    }
}

@Composable
private fun EmojiRow(e: Emoji, uploader: String, manage: Boolean, onRename: () -> Unit, onDelete: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val density = LocalDensity.current.density
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AsyncImage(Media.emojiUrl(e.blobId, 32, density), ":${e.name}:", Media.loader, Modifier.size(32.dp), contentScale = ContentScale.Fit)
        Column(Modifier.weight(1f)) {
            Txt(":${e.name}:", style = Nx.type.code.copy(fontSize = Nx.type.sp(13f)), color = c.text, maxLines = 1)
            Txt(t("server.emoji.uploadedBy") + ": " + uploader, style = Nx.type.hint, color = c.textMuted, maxLines = 1)
        }
        if (manage) {
            RowIconButton("Pencil", t("server.packEditor.rename"), onRename)
            RowIconButton("Trash2", t("server.emoji.deleteEmoji"), onDelete, danger = true)
        }
    }
}

/** `.dropzone`: a dashed box that opens the file picker (a phone has nothing to drop). */
@Composable
fun DropZone(text: String, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .dashedOutline(if (pressed) c.textMuted else c.borderStrong, Radii.sm, 2.dp)
            .clip(Radii.Sm)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = text }
            .padding(24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        Icon("Upload", if (pressed) c.text else c.textMuted, size = 20.dp)
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = if (pressed) c.text else c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.weight(1f, fill = false))
    }
}
