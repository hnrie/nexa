package fish.nexa.ui.apps

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.AppCommands
import fish.nexa.data.Apps
import fish.nexa.data.P
import fish.nexa.net.AuthorizeInfo
import fish.nexa.net.Api
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.media.HookTags
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import java.net.URLDecoder
import java.net.URLEncoder

/** A link's query as ordered pairs, as URLSearchParams reads one. */
private fun parseQuery(q: String): MutableList<Pair<String, String>> = q.split('&').filter { it.isNotEmpty() }.map { part ->
    val k = part.substringBefore('=')
    val v = part.substringAfter('=', "")
    URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
}.toMutableList()

/** And written back, spaces as %20 (an app's scopes are a list of words). */
private fun writeQuery(pairs: List<Pair<String, String>>): String =
    pairs.joinToString("&") { (k, v) -> URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(v, "UTF-8").replace("+", "%20") }

/** What an app may do, in words, from the scopes it asks for (web AuthorizedAppsPage scopeWords). */
fun scopeWords(scopes: List<String>, installed: Boolean): List<String> {
    val out = ArrayList<String>()
    if (installed || "applications.commands" in scopes) out += t("apps.authorized.commands")
    if ("identify" in scopes) out += t("apps.authorized.identify")
    if ("email" in scopes) out += t("apps.authorized.email")
    if ("guilds" in scopes) out += t("apps.authorized.guilds")
    if ("guilds.join" in scopes) out += t("apps.authorized.guildsJoin")
    if ("guilds.members.read" in scopes) out += t("apps.authorized.membersRead")
    if ("connections" in scopes) out += t("apps.authorized.connections")
    return out
}

/**
 * What a link that adds an app opens (web pages/AuthorizePage.tsx): what the
 * app is, where it goes (a server this account manages, or the account
 * itself), what it will be able to do there, and what it can read. Each
 * permission its bot asks for can be taken away before saying yes; none can
 * be added. `query` is the link's query (client_id, scope, permissions, ...).
 */
fun openAuthorize(query: String, fromApp: Boolean = false) {
    lateinit var layer: Layer
    layer = Layer("authorize") { close -> AuthorizeSheet(layer, query, close, fromApp) }
    Layers.open(layer)
}

/** [fromApp]: opened by Add App inside the app, so a yes closes the sheet with a toast, leaving the person where they were. */
@Composable
private fun AuthorizeSheet(layer: Layer, initialQuery: String, close: () -> Unit, fromApp: Boolean) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf(initialQuery) }
    var info by remember { mutableStateOf<AuthorizeInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var guild by remember { mutableStateOf<String?>(null) }
    var granted by remember { mutableLongStateOf(0L) }
    var busy by remember { mutableStateOf(false) }
    // done: where it went (null for the account), and whether the app takes the person on from here
    var done by remember { mutableStateOf<Pair<String?, Boolean>?>(null) }
    LaunchedEffect(query) {
        error = null
        try {
            val res = Apps.authorizeInfo(query)
            info = res
            granted = P.parse(res.permissions)
            val usable = res.servers.orEmpty().filter { !it.banned }
            guild = guild ?: res.guildId ?: usable.singleOrNull()?.id
        } catch (e: Exception) {
            error = describeError(e, t("apps.consent.couldNotLoad"))
        }
    }
    val i = info
    val toAccount = i?.integrationType == 1
    val ways = i?.application?.installTypes.orEmpty()
    // a link that did not say how, for an app that goes both ways, lets the person choose
    val canChoose = i != null && !i.typeChosen && 0 in ways && 1 in ways
    fun choose(type: Int) {
        val q = parseQuery(query)
        q.removeAll { it.first == "integration_type" }
        q += "integration_type" to type.toString()
        if (type == 1) {
            val scopes = (q.firstOrNull { it.first == "scope" }?.second ?: "applications.commands").split(Regex("[ +]")).filter { it.isNotEmpty() && it != "bot" && it != "webhook.incoming" }
            q.removeAll { it.first == "scope" }
            q += "scope" to scopes.joinToString(" ").ifEmpty { "applications.commands" }
        }
        info = null
        query = writeQuery(q)
    }
    val asksBot = i?.scopes?.contains("bot") == true
    val requested = P.parse(i?.permissions)
    val words = when {
        i == null -> emptyList()
        toAccount -> scopeWords(i.scopes, true)
        else -> {
            val rest = scopeWords(i.scopes.filter { it != "bot" && it != "applications.commands" }, false)
            if ("applications.commands" in i.scopes) listOf(t("apps.consent.serverCommands")) + rest else rest
        }
    }
    val servers = i?.servers.orEmpty()
    val picked = servers.firstOrNull { it.id == guild }
    fun browse(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }

    fun authorize() {
        if (info == null || busy || (!toAccount && guild == null)) return
        busy = true
        scope.launch {
            try {
                val res = Apps.authorize(query, if (!toAccount) guild else null, if (asksBot) java.lang.Long.toUnsignedString(granted) else null)
                AppCommands.forget()
                val location = Api.str(res, "location")
                if (location != null) {
                    done = null to true
                    browse(location)
                } else if (fromApp) {
                    val name = info?.application?.name.orEmpty()
                    Nexa.ui.toast(if (toAccount) t("apps.consent.addedToAccount", "app" to name) else t("apps.consent.addedToServer", "app" to name, "server" to (picked?.name ?: "")), "success")
                    close()
                } else done = Api.str(res, "guild_id") to false
            } catch (e: Exception) {
                error = describeError(e, t("apps.consent.failed"))
            } finally {
                busy = false
            }
        }
    }

    fun cancel() {
        // the app is told it was turned down, where it said to send people back
        val redirect = info?.redirectUri?.takeIf { it.isNotEmpty() }
        if (redirect != null) {
            val state = parseQuery(query).firstOrNull { it.first == "state" }?.second
            val sep = if (redirect.contains('?')) "&" else "?"
            browse(redirect + sep + "error=access_denied" + (state?.let { "&state=" + URLEncoder.encode(it, "UTF-8") } ?: ""))
        }
        close()
    }

    Sheet(layer, maxWidth = 520.dp, closeButton = false, padding = 20.dp) {
        val d = done
        when {
            i == null && error == null -> Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) { Spinner() }
            i == null -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(56.dp).background(c.danger.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) { Icon("TriangleAlert", c.textDanger, size = 26.dp) }
                Txt(t("apps.consent.unavailable"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(21f), fontWeight = FontWeight(700)), color = c.textStrong, align = TextAlign.Center, modifier = Modifier.semantics { heading() })
                Txt(error ?: "", style = Nx.type.body, color = c.textMuted, align = TextAlign.Center)
                NxButton(t("chat.attachments.close"), close, kind = ButtonKind.SECONDARY, block = true)
            }
            d != null -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon("CircleCheck", c.positive, size = 56.dp, modifier = Modifier.padding(top = 8.dp))
                Txt(
                    when {
                        d.second -> t("apps.consent.redirecting", "app" to i.application.name)
                        toAccount -> t("apps.consent.addedToAccount", "app" to i.application.name)
                        else -> t("apps.consent.addedToServer", "app" to i.application.name, "server" to (picked?.name ?: ""))
                    },
                    style = Nx.type.heading.copy(fontSize = Nx.type.sp(21f), fontWeight = FontWeight(700)), color = c.textStrong, align = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                if (!d.second) {
                    val gid = d.first
                    if (gid != null) NxButton(t("apps.consent.goToServer", "server" to (picked?.name ?: "")), { close(); Nav.go(Route.Server(gid)) }, size = ButtonSize.LG, block = true)
                    else NxButton(t("stickerPack.backToTheApp"), close, size = ButtonSize.LG, block = true)
                }
            }
            else -> {
                // the app first: its picture, its name (an app's, so not end-to-end encrypted), what it asks, its own words
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(22.dp)).ring(RoundedCornerShape(22.dp), c.panelEdge)) {
                        Avatar(i.application.id, i.application.name, i.application.iconId ?: i.application.bot?.avatarId, 72.dp, icon = i.application.iconId != null, shape = fish.nexa.ui.components.SQUARE_AVATAR)
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), itemVerticalAlignment = Alignment.CenterVertically) {
                        Txt(i.application.name, style = Nx.type.heading.copy(fontSize = Nx.type.sp(24f), fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.semantics { heading() })
                        HookTags(null, app = true)
                    }
                    Txt(if (toAccount) t("apps.consent.wantsAccount") else t("apps.consent.wantsServer"), style = Nx.type.body.copy(fontSize = Nx.type.sp(16f), fontWeight = FontWeight(550)), color = c.textSubtle, align = TextAlign.Center)
                    if (i.application.description.isNotEmpty()) Txt(i.application.description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(20f)), color = c.textMuted, align = TextAlign.Center)
                }
                if (canChoose) Row(
                    Modifier.fillMaxWidth().sunken(Radii.Md, c).padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    WayTab(t("apps.consent.addToServer"), !toAccount, Modifier.weight(1f)) { if (toAccount) choose(0) }
                    WayTab(t("apps.consent.addToAccount"), toAccount, Modifier.weight(1f)) { if (!toAccount) choose(1) }
                }
                if (!toAccount) Section(t("apps.consent.pickServer")) {
                    if (servers.isEmpty()) Txt(t("apps.consent.noServers"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (sv in servers) {
                            val locked = sv.banned || (i.disableGuildSelect && i.guildId != null && sv.id != i.guildId)
                            val on = guild == sv.id
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 52.dp)
                                    .clip(Radii.Md)
                                    .then(if (on) Modifier.ring(Radii.Md, c.brand.copy(alpha = 0.75f), 2.dp).background(c.brand.copy(alpha = 0.12f), Radii.Md).background(sheen(c), Radii.Md) else Modifier)
                                    .alpha(if (locked) 0.55f else 1f)
                                    .pressable(remember(sv.id) { MutableInteractionSource() }, enabled = !locked, role = Role.RadioButton) { guild = sv.id }
                                    .semantics { selected = on }
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Box(Modifier.size(18.dp).border(2.dp, if (on) c.brand else c.borderStrong, CircleShape), contentAlignment = Alignment.Center) {
                                    if (on) Box(Modifier.size(9.dp).background(c.brand, CircleShape))
                                }
                                Avatar(sv.id, sv.name, sv.iconId, 32.dp, icon = true, shape = fish.nexa.ui.components.SQUARE_AVATAR)
                                Column(Modifier.weight(1f)) {
                                    Txt(sv.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                                    if (sv.banned) Txt(t("apps.consent.banned"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
                                    else if (sv.hasBot) Txt(t("apps.consent.alreadyThere"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
                                }
                            }
                        }
                    }
                }
                if (words.isNotEmpty()) Section(t("apps.consent.itCan")) {
                    for (w in words) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon("CircleCheck", c.positive, size = 16.dp, modifier = Modifier.padding(top = 2.dp))
                        Txt(w, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(20f)), color = c.text)
                    }
                }
                if (asksBot && requested != 0L) Section(t("apps.consent.botCan")) {
                    if (requested and P.ADMINISTRATOR != 0L) Row(
                        Modifier.fillMaxWidth().background(c.warning.copy(alpha = 0.10f), Radii.Sm).border(1.dp, c.warning.copy(alpha = 0.45f), Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon("ShieldAlert", c.textWarning, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
                        Txt(t("apps.consent.adminWarning"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18f)), color = c.text)
                    }
                    PermissionPicker(granted, { granted = it }, only = requested)
                }
                if (asksBot) Section(t("apps.glass.title", "app" to i.application.name)) {
                    ReadingGlass(i.application.name, i.application.intents.messageContent, compact = true)
                }
                error?.let { e ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon("TriangleAlert", c.textDanger, size = 16.dp, modifier = Modifier.padding(top = 2.dp))
                        Txt(e, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textDanger)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    NxButton(t("apps.cancel"), { cancel() }, kind = ButtonKind.SECONDARY, size = ButtonSize.LG, modifier = Modifier.weight(1f))
                    NxButton(t("apps.consent.authorize"), { authorize() }, size = ButtonSize.LG, loading = busy, enabled = toAccount || guild != null, modifier = Modifier.weight(1f))
                }
                // what the app says about itself, and where the person goes afterwards
                val fine = buildList {
                    if (i.application.createdAt > 0) add(t("apps.consent.madeOn", "date" to Time.shortDate(i.application.createdAt)))
                    if (i.redirectUri.isNotEmpty()) add(t("apps.consent.redirectTo", "host" to (runCatching { Uri.parse(i.redirectUri).host }.getOrNull() ?: i.redirectUri)))
                }
                if (i.application.termsUrl.isNotEmpty() || i.application.privacyUrl.isNotEmpty()) FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt(t("apps.consent.theirTerms", "app" to i.application.name), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, align = TextAlign.Center)
                    if (i.application.termsUrl.isNotEmpty()) FineLink(t("apps.consent.terms")) { browse(i.application.termsUrl) }
                    if (i.application.privacyUrl.isNotEmpty()) FineLink(t("apps.consent.privacy")) { browse(i.application.privacyUrl) }
                }
                if (fine.isNotEmpty()) Txt(fine.joinToString("   "), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(17f)), color = c.textMuted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** A part of the consent page under a line of its own, with its heading. */
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        Txt(title, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
        content()
    }
}

/** One of the two ways an app can be added, as a tab. */
@Composable
private fun WayTab(label: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Nx.colors
    Box(
        modifier
            .height(40.dp)
            .clip(Radii.Sm)
            .then(if (on) Modifier.background(c.bgSurface, Radii.Sm).background(sheen(c), Radii.Sm).ring(Radii.Sm, c.borderSubtle).topEdge(Radii.Sm, c.edgeLight) else Modifier)
            .pressable(remember { MutableInteractionSource() }, role = Role.Tab, onClick = onClick)
            .semantics { selected = on },
        contentAlignment = Alignment.Center,
    ) { Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.textMuted, maxLines = 1) }
}

@Composable
private fun FineLink(label: String, onClick: () -> Unit) {
    Txt(
        label, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(550)), color = Nx.colors.link,
        modifier = Modifier.pressable(remember { MutableInteractionSource() }, onClick = onClick).padding(vertical = 8.dp),
    )
}
