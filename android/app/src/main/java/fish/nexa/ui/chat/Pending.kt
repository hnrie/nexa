// TEMPORARY: each of these is replaced by its real file (media, embeds, polls, stickers, server tags,
// the expression picker) before release; tracked in the progress log.
package fish.nexa.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.fillMaxSize
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.StickerRef
import fish.nexa.data.ChatMessage
import fish.nexa.data.PendingMessage
import fish.nexa.data.PendingUpload
import fish.nexa.net.WornTag
import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.theme.Nx
import kotlinx.serialization.json.JsonObject
import kotlinx.coroutines.launch

/** A picture a menu was opened on: what Copy Image and Save Image act on. */
class ImageTarget(val meta: AttachmentMeta, val cm: ChatMessage?)

fun imageMenuItems(image: ImageTarget): List<MenuItem> = emptyList()

@Composable fun StickerView(sticker: StickerRef) = Txt(fish.nexa.ui.t("chat.messageItem.sticker"), color = Nx.colors.textMuted)
@Composable fun PollCard(cm: ChatMessage, ctx: ListCtx) = Txt(cm.payload?.poll?.question ?: "", color = Nx.colors.textStrong)
@Composable fun UploadCard(channelId: String, p: PendingMessage, up: PendingUpload) = Txt("${up.loaded} / ${up.total}", color = Nx.colors.textMuted)
@Composable fun Attachments(att: List<AttachmentMeta>, cm: ChatMessage?, ctx: ListCtx) { for (a in att) Txt(a.name, color = Nx.colors.link) }
@Composable fun Embeds(embeds: List<JsonObject>, cm: ChatMessage, ctx: ListCtx) = Unit
@Composable fun ServerTagChip(tag: WornTag, small: Boolean) = Txt(tag.text, color = Nx.colors.textBrand)
/** Add Reaction: the emoji tab alone, closing on a pick, which toggles that reaction. */
fun openReactionPicker(cm: ChatMessage, ctx: ListCtx) = fish.nexa.ui.pickers.Pickers.open(
    fish.nexa.ui.pickers.Pickers.Opener(listOf(fish.nexa.ui.pickers.Pickers.Tab.EMOJI), ctx.server?.server?.id, draggable = false, closeOnEmoji = true, onEmoji = { p ->
        val key = p.custom?.let { (if (it.animated) "a" else "") + ":" + it.name + ":" + it.blobId }
            ?: p.packEmoji?.let { (if (it.animated) "a" else "") + ":" + it.name + ":" + it.blobId } ?: p.text
        val mine = cm.m.reactions.any { it.emoji == key && it.me }
        fish.nexa.data.Send.react(cm.channelId, cm.id, key, add = !mine)
    }),
)

fun openFormattingEditor(channelId: String, text: String, onInsert: (String) -> Unit) = Unit
/** The composer's picker: emoji go in at the caret (it stays open); a sticker or GIF goes at once, with the reply waiting. */
fun openExpressionPicker(channelId: String, onPick: (String) -> Unit) {
    val serverId = fish.nexa.Nexa.channels.get(channelId)?.serverId
    fun reply(): fish.nexa.data.SendOptions {
        val r = ChatUi.reply.remove(channelId)
        return fish.nexa.data.SendOptions(replyTo = r?.messageId, ping = r?.ping)
    }
    fish.nexa.ui.pickers.Pickers.open(fish.nexa.ui.pickers.Pickers.Opener(
        listOf(fish.nexa.ui.pickers.Pickers.Tab.GIFS, fish.nexa.ui.pickers.Pickers.Tab.STICKERS, fish.nexa.ui.pickers.Pickers.Tab.EMOJI), serverId,
        onEmoji = { onPick(it.text) },
        onSticker = { s ->
            fish.nexa.data.Send.sendMessage(channelId, "", reply().copy(sticker = StickerRef(s.id, s.blobId, s.name, s.width?.toDouble(), s.height?.toDouble(), s.animated, s.format)))
            fish.nexa.Nexa.scope.launch { runCatching { fish.nexa.Nexa.api.request("POST", "/stickers/recent", kotlinx.serialization.json.buildJsonObject { put("sticker_id", kotlinx.serialization.json.JsonPrimitive(s.id)) }) } }
        },
        onGif = { g ->
            val embed = kotlinx.serialization.json.buildJsonObject {
                put("url", kotlinx.serialization.json.JsonPrimitive(g.url)); put("type", kotlinx.serialization.json.JsonPrimitive("gif")); put("image", kotlinx.serialization.json.JsonPrimitive(g.url))
                g.w?.let { put("image_w", kotlinx.serialization.json.JsonPrimitive(it)) }; g.h?.let { put("image_h", kotlinx.serialization.json.JsonPrimitive(it)) }
            }
            fish.nexa.data.Send.sendMessage(channelId, g.url, reply().copy(embeds = listOf(embed)))
        },
    ))
}

/** lib/scrubMetadata.ts: removes a photo's or video's metadata (place, camera) before it is sent. */
object MetadataScrub { fun scrub(file: java.io.File, type: String) = Unit }

fun openChannelTopic(channel: fish.nexa.net.Channel) = Unit
fun openVerifyKey(userId: String) = Unit
fun openBugReport(from: String) = Unit

@Composable fun FriendsPage() { androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.fillMaxSize()) { fish.nexa.ui.shell.PageHeader(fish.nexa.ui.t("sidebar.dMSidebar.friends")) } }
@Composable fun MemberList(serverId: String, channelId: String?) = Unit
@Composable fun GroupMemberList(channel: fish.nexa.net.Channel) = Unit
