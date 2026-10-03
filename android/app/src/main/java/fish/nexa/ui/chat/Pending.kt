// TEMPORARY: each of these is replaced by its real file (the expression picker, panels, profiles, dialogs)
// before release; tracked in the progress log.
package fish.nexa.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.fillMaxSize
import fish.nexa.data.ChatMessage

fun openReactionPicker(cm: ChatMessage, ctx: ListCtx) = Unit

fun openCreatePoll(channelId: String) = Unit
fun openFormattingEditor(channelId: String, text: String, onInsert: (String) -> Unit) = Unit
fun openExpressionPicker(channelId: String, onPick: (String) -> Unit) = Unit
fun emojiSuggestions(channel: fish.nexa.net.Channel, query: String): List<AcItem> = emptyList()

fun openChannelTopic(channel: fish.nexa.net.Channel) = Unit
fun openVerifyKey(userId: String) = Unit
fun openBugReport(from: String) = Unit
@Composable fun ChatPanels(channel: fish.nexa.net.Channel) = Unit

@Composable fun FriendsPage() { androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.fillMaxSize()) { fish.nexa.ui.shell.PageHeader(fish.nexa.ui.t("sidebar.dMSidebar.friends")) } }
@Composable fun MemberList(serverId: String, channelId: String?) = Unit
@Composable fun GroupMemberList(channel: fish.nexa.net.Channel) = Unit
