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

/** A picture a menu was opened on: what Copy Image and Save Image act on. */
class ImageTarget(val meta: AttachmentMeta, val cm: ChatMessage?)

fun imageMenuItems(image: ImageTarget): List<MenuItem> = emptyList()

@Composable fun StickerView(sticker: StickerRef) = Txt(fish.nexa.ui.t("chat.messageItem.sticker"), color = Nx.colors.textMuted)
@Composable fun PollCard(cm: ChatMessage, ctx: ListCtx) = Txt(cm.payload?.poll?.question ?: "", color = Nx.colors.textStrong)
@Composable fun UploadCard(channelId: String, p: PendingMessage, up: PendingUpload) = Txt("${up.loaded} / ${up.total}", color = Nx.colors.textMuted)
@Composable fun Attachments(att: List<AttachmentMeta>, cm: ChatMessage?, ctx: ListCtx) { for (a in att) Txt(a.name, color = Nx.colors.link) }
@Composable fun Embeds(embeds: List<JsonObject>, cm: ChatMessage, ctx: ListCtx) = Unit
@Composable fun ServerTagChip(tag: WornTag, small: Boolean) = Txt(tag.text, color = Nx.colors.textBrand)
fun openReactionPicker(cm: ChatMessage, ctx: ListCtx) = Unit

fun openCreatePoll(channelId: String) = Unit
fun openFormattingEditor(channelId: String, text: String, onInsert: (String) -> Unit) = Unit
fun openExpressionPicker(channelId: String, onPick: (String) -> Unit) = Unit
fun emojiSuggestions(channel: fish.nexa.net.Channel, query: String): List<AcItem> = emptyList()

/** lib/scrubMetadata.ts: removes a photo's or video's metadata (place, camera) before it is sent. */
object MetadataScrub { fun scrub(file: java.io.File, type: String) = Unit }

fun openChannelTopic(channel: fish.nexa.net.Channel) = Unit
fun openBugReport(from: String) = Unit
@Composable fun ChatPanels(channel: fish.nexa.net.Channel) = Unit

@Composable fun MemberList(serverId: String, channelId: String?) = Unit
@Composable fun GroupMemberList(channel: fish.nexa.net.Channel) = Unit
