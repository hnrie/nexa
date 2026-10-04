package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.net.ApiError
import fish.nexa.net.GroupAddNotice
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.components.touchOutset
import fish.nexa.ui.profile.NexaAvatar
import fish.nexa.ui.profile.OfficialBadge
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.launch

/**
 * GroupAddNoticeRow.tsx: Nexa's note to someone a friend put in this group
 * directly. It is drawn among the messages but is not one of them: nobody
 * else sees it, it is never unread, searched or exported, and Dismiss takes
 * it away on every device.
 */
@Composable
fun GroupAddNoticeRow(notice: GroupAddNotice) {
    val c = Nx.colors
    val link = SpanStyle(color = c.link, fontWeight = FontWeight(500))
    val name = Names.shown(notice.addedBy)
    val body = remember(name, c.link) {
        val template = t("groupAdd.notice.body", "setting" to t("settings.privacy.letFriendsAddMe"))
        buildAnnotatedString {
            var i = 0
            for (m in Regex("\\{(name|where)\\}").findAll(template)) {
                append(template.substring(i, m.range.first))
                if (m.groupValues[1] == "name") withLink(LinkAnnotation.Clickable("adder", TextLinkStyles(link)) { openProfile(notice.addedBy) }) { append(name) }
                else withLink(LinkAnnotation.Clickable("where", TextLinkStyles(link)) { fish.nexa.ui.settings.Settings.open("privacy") }) { append(t("groupAdd.notice.where")) }
                i = m.range.last + 1
            }
            append(template.substring(i))
        }
    }
    Box(Modifier.fillMaxWidth().padding(top = 17.dp).background(c.brand.copy(alpha = 0.07f))) {
        // the message avatar's place, without the press: Nexa has no profile to open from here
        Box(Modifier.padding(start = 12.dp, top = 2.dp)) { NexaAvatar(40.dp) }
        Column(Modifier.fillMaxWidth().padding(start = 64.dp, end = 16.dp, top = 2.dp, bottom = 6.dp)) {
            Row(Modifier.heightIn(min = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("Nexa", style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.textStrong, maxLines = 1)
                OfficialBadge(compact = true)
                Txt(Time.timestamp(notice.addedAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
            }
            BasicText(body, style = Nx.type.body.copy(color = c.text))
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon("Eye", c.textMuted, size = 14.dp)
                val foot = Nx.type.timestamp.copy(fontSize = Nx.type.sp(12f), lineHeight = Nx.type.sp(16f))
                Txt(t("groupAdd.notice.onlyYou"), style = foot, color = c.textMuted)
                Txt("·", style = foot, color = c.textMuted)
                // a finger-sized target without moving the line it sits on
                Box(Modifier.touchOutset(6.dp, 10.dp).pressable(remember { MutableInteractionSource() }) { dismissNotice(notice) }.padding(vertical = 10.dp, horizontal = 6.dp)) {
                    Txt(t("groupAdd.notice.dismiss"), style = foot, color = c.link)
                }
            }
        }
    }
}

/** Takes the note away here at once; the server tells the other devices. A failure puts it back. */
private fun dismissNotice(notice: GroupAddNotice) {
    val store = Nexa.misc.groupAddNotices
    store.value = store.value.remove(notice.channelId)
    Nexa.scope.launch {
        try {
            Nexa.api.request("DELETE", "/channels/${notice.channelId}/add-notice")
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // out of the group already: there is nothing left to dismiss
            if ((e as? ApiError)?.status == 404) return@launch
            if (store.value[notice.channelId] == null) store.value = store.value.put(notice.channelId, notice)
            Nexa.ui.toast(fish.nexa.ui.describeError(e, t("groupAdd.notice.couldNotDismiss")), "error")
        }
    }
}
