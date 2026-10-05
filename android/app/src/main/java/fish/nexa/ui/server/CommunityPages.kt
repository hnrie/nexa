package fish.nexa.ui.server

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.net.Server
import fish.nexa.ui.I18n
import fish.nexa.ui.Icon
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleRow
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Saves part of a server's settings and takes the server's own copy back. */
internal suspend fun patchServer(serverId: String, body: Map<String, JsonElement>): Server {
    val srv = Nexa.api.request("PATCH", "/servers/$serverId", Server.serializer(), JsonObject(body))
    Nexa.servers.setServer(srv)
    return srv
}

private val ACCOUNT_WAITS = listOf(0, 10, 60, 24 * 60, 7 * 24 * 60, 30 * 24 * 60)
private val MEMBER_WAITS = listOf(0, 5, 10, 30, 60, 24 * 60)

private fun waitLabel(minutes: Int) = if (minutes == 0) t("safety.noWait") else formatSpan(minutes * 60_000L)

/**
 * SafetyPage.tsx: how long newcomers wait before they can talk (an account
 * that new, or a membership that new), with the other tools a moderator
 * reaches for when trouble comes, AutoMod and pausing invites.
 */
@Composable
fun SafetyPage(serverId: String, go: (String) -> Unit) {
    val servers by Nexa.servers.byId.collectAsState()
    val server = servers[serverId]?.server ?: return
    var account by remember { mutableStateOf<Int?>(null) }
    var member by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val acc = account ?: server.verifyAccountMinutes
    val mem = member ?: server.verifyMemberMinutes
    val dirty = acc != server.verifyAccountMinutes || mem != server.verifyMemberMinutes
    fun save() {
        busy = true
        scope.launch {
            try {
                patchServer(serverId, mapOf("verify_account_minutes" to JsonPrimitive(acc), "verify_member_minutes" to JsonPrimitive(mem)))
                account = null
                member = null
                Nexa.ui.toast(t("safety.saved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("safety.failed")), "error")
            } finally {
                busy = false
            }
        }
    }
    SettingsPage(SaveState(dirty, busy, { account = null; member = null }, ::save)) {
        PageTitle(t("safety.title"))
        Form {
            Column {
                H5(t("safety.newcomers"), top = 0.dp)
                Hint(t("safety.newcomersDesc"), top = 0.dp)
            }
            Field(t("safety.accountAge"), hint = t("safety.accountAgeHint")) {
                SelectField(ACCOUNT_WAITS.map { it to waitLabel(it) }, acc, { account = it }, title = t("safety.accountAge"))
            }
            Field(t("safety.memberAge"), hint = t("safety.memberAgeHint")) {
                SelectField(MEMBER_WAITS.map { it to waitLabel(it) }, mem, { member = it }, title = t("safety.memberAge"))
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                H5(t("safety.more"), top = 8.dp)
                InlineLink(t("safety.toAutomod")) { go("automod") }
                InlineLink(t("safety.toInvites")) { go("invites") }
            }
        }
    }
}

@Composable
private fun InlineLink(text: String, onClick: () -> Unit) {
    Txt(
        text,
        style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(19.6f), fontWeight = FontWeight(550)),
        color = Nx.colors.link,
        modifier = Modifier.fillMaxWidth().pressable(remember { MutableInteractionSource() }, onClick = onClick).padding(vertical = 8.dp),
    )
}

private val CATEGORIES = listOf("gaming", "music", "entertainment", "creative", "science_tech", "education", "anime", "sports", "community", "other")
private const val MAX_TAGS = 5

/**
 * DiscoverySettingsPage.tsx: how a server shows on Discovery: whether it is
 * listed at all, its category, the tags people find it by, and its language.
 * What it says about itself is the description on Overview.
 */
@Composable
fun DiscoverySettingsPage(serverId: String) {
    val c = Nx.colors
    val servers by Nexa.servers.byId.collectAsState()
    val presence by Nexa.presence.byId.collectAsState()
    val st = servers[serverId] ?: return
    val server = st.server
    var listed by remember { mutableStateOf<Boolean?>(null) }
    var category by remember { mutableStateOf<String?>(null) }
    var tags by remember { mutableStateOf<List<String>?>(null) }
    var language by remember { mutableStateOf<String?>(null) }
    var tagText by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val isListed = listed ?: server.discoverable
    val cat = category ?: server.discoveryCategory
    val tagList = tags ?: server.discoveryTags
    val lang = language ?: server.discoveryLanguage
    val dirty = isListed != server.discoverable || cat != server.discoveryCategory || tagList != server.discoveryTags || lang != server.discoveryLanguage
    fun reset() {
        listed = null; category = null; tags = null; language = null
    }
    fun addTag() {
        val tag = tagText.trim().lowercase().replace(Regex("\\s+"), " ").take(20)
        if (tag.isEmpty() || tag in tagList || tagList.size >= MAX_TAGS) return
        tags = tagList + tag
        tagText = ""
    }
    fun save() {
        busy = true
        scope.launch {
            try {
                patchServer(serverId, mapOf(
                    "discoverable" to JsonPrimitive(isListed),
                    "discovery_category" to JsonPrimitive(cat),
                    "discovery_tags" to JsonArray(tagList.map { JsonPrimitive(it) }),
                    "discovery_language" to JsonPrimitive(lang),
                ))
                Nexa.ui.toast(if (isListed) t("discovery.settings.savedListed") else t("discovery.settings.saved"), "success")
                reset()
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("discovery.settings.failed")), "error")
            } finally {
                busy = false
            }
        }
    }
    SettingsPage(SaveState(dirty, busy, ::reset, ::save)) {
        PageTitle(t("discovery.title"), gap = 10.dp)
        Hint(t("discovery.settings.intro"), Modifier.padding(bottom = 20.dp), top = 0.dp)
        Form {
            ToggleRow(isListed, { listed = it }, t("discovery.settings.list"), t("discovery.settings.listDesc"))
            if (server.discoveryHidden) Row(
                Modifier.fillMaxWidth().background(c.warning.copy(alpha = 0.14f), RoundedCornerShape(10.dp)).padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("TriangleAlert", c.textWarning, size = 16.dp)
                Txt(t("discovery.settings.hidden"), style = Nx.type.bodySmall, color = c.text)
            }
            Field(t("discovery.settings.category")) {
                SelectField(listOf("" to t("discovery.settings.noCategory")) + CATEGORIES.map { it to t("discovery.cat.$it") }, cat, { category = it }, title = t("discovery.settings.category"))
            }
            Field(t("discovery.settings.tags"), hint = t("discovery.settings.tagsHint", "count" to MAX_TAGS)) {
                if (tagList.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // `.tagChip[aria-pressed]`: the accent mixed into the surface, ringed in it
                    for (tg in tagList) Row(
                        Modifier
                            .heightIn(min = 32.dp)
                            .background(fish.nexa.ui.theme.mixSrgb(c.brand, c.bgSurface, 0.78f), RoundedCornerShape(999.dp))
                            .ring(RoundedCornerShape(999.dp), c.brand.copy(alpha = 0.7f))
                            .padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Txt(tg, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textStrong)
                        Box(
                            Modifier.size(32.dp).pressable(remember { MutableInteractionSource() }) { tags = tagList - tg }.semantics { contentDescription = t("discovery.settings.removeTag", "tag" to tg) },
                            contentAlignment = Alignment.Center,
                        ) { Icon("X", c.textMuted, size = 13.dp) }
                    }
                }
                if (tagList.size < MAX_TAGS) NxTextField(
                    tagText,
                    { v -> if (v.endsWith(",")) { tagText = v.dropLast(1); addTag() } else tagText = v.take(20) },
                    placeholder = t("discovery.settings.tagPlaceholder"),
                    imeAction = ImeAction.Done,
                    onIme = ::addTag,
                )
            }
            Field(t("discovery.settings.language")) {
                SelectField(listOf("" to t("discovery.anyLanguage")) + I18n.languages.map { it.tag to it.endonym }, lang, { language = it }, title = t("discovery.settings.language"))
            }
            Field(t("discovery.settings.preview"), hint = if (server.description.isBlank()) t("discovery.settings.noDescription") else null) {
                fish.nexa.ui.discovery.ServerCard(
                    fish.nexa.ui.discovery.DiscoveryCard(
                        id = server.id, name = server.name, iconId = server.iconId, bannerId = server.bannerId, description = server.description,
                        category = cat, tags = tagList, language = lang, memberCount = st.memberCount, createdAt = server.createdAt,
                        // the members this app has loaded who are about now, which is everyone in a small server
                        onlineCount = st.members.keys.count { id ->
                            val status = presence[id]?.status ?: if (id == Nexa.users.meId) "online" else null
                            status != null && status != "offline" && status != "invisible"
                        },
                    ),
                    onTag = {},
                    onOpen = {},
                )
            }
        }
    }
}
