package fish.nexa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Apps
import fish.nexa.net.OwnedApp
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.SQUARE_AVATAR
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.SheetTitle
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.media.HookTags
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * The app open in the Developer Portal and what has been changed on it and
 * not saved yet (its own fields, in the server's shape, and its bot's),
 * shared with the page's save bar.
 */
object PortalEditing {
    class Form(app: OwnedApp, val onSaved: (OwnedApp) -> Unit) {
        var app by mutableStateOf(app)
        val draft = mutableStateMapOf<String, JsonElement>()
        val bot = mutableStateMapOf<String, JsonElement>()
        var saving by mutableStateOf(false)
        val dirty get() = draft.isNotEmpty() || bot.isNotEmpty()

        fun str(key: String, saved: String): String = (draft[key] as? JsonPrimitive)?.contentOrNull ?: saved
        fun bool(key: String, saved: Boolean): Boolean = (draft[key] as? JsonPrimitive)?.booleanOrNull ?: saved
        fun set(key: String, value: JsonElement) {
            draft[key] = value
        }

        fun reset() {
            draft.clear()
            bot.clear()
        }

        suspend fun save() {
            saving = true
            try {
                var next = app
                if (draft.isNotEmpty()) next = Apps.update(app.id, JsonObject(draft.toMap()))
                if (bot.isNotEmpty()) {
                    val b = Apps.updateBot(app.id, JsonObject(bot.toMap()))
                    next = next.copy(bot = b)
                    Nexa.users.upsert(listOf(b))
                }
                app = next
                reset()
                onSaved(next)
                Nexa.ui.toast(t("apps.portal.saved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("apps.portal.saveFailed")), "error")
            } finally {
                saving = false
            }
        }
    }

    var form by mutableStateOf<Form?>(null)
}

/** The bar that saves an app's settings, over the bottom of the page while they differ. */
@Composable
fun BoxScope.PortalSaveBar() {
    val form = PortalEditing.form
    SaveBar(
        dirty = form?.dirty == true,
        saving = form?.saving == true,
        onReset = { form?.reset() },
        onSave = { form?.let { f -> Nexa.scope.launch(kotlinx.coroutines.Dispatchers.Main) { f.save() } } },
    )
}

/**
 * Settings, Developer Portal (web components/settings/portal/
 * DeveloperPortalPage.tsx): the apps this account made, and the way to make
 * one. An app is a program with a bot account, which people add to their
 * servers or their own account; its bot is run by a bot library made for
 * Discord (discord.py, discord.js, discordgo and the rest), pointed at this
 * server with the lines shown here.
 */
@Composable
fun DeveloperPortalPage() {
    var list by remember { mutableStateOf<List<OwnedApp>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            list = Apps.mine()
        } catch (_: Exception) {
            failed = true
        }
    }
    fun changed(app: OwnedApp?, id: String? = null) {
        val cur = list ?: return
        list = when {
            app == null -> cur.filter { it.id != id }
            cur.any { it.id == app.id } -> cur.map { if (it.id == app.id) app else it }
            else -> listOf(app) + cur
        }
    }
    val current = open?.let { id -> list?.firstOrNull { it.id == id } }
    if (current != null) {
        AppDetail(
            current,
            onBack = { Unsaved.unlessUnsaved { open = null } },
            onChange = { changed(it) },
            onDeleted = {
                changed(null, current.id)
                open = null
            },
        )
        return
    }
    val c = Nx.colors
    PageTitle(t("apps.portal.title"))
    Txt(t("apps.portal.intro"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f)), color = c.textSubtle, modifier = Modifier.padding(top = 0.dp, bottom = 18.dp))
    FlowRow(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        NxButton(t("apps.portal.newApp"), { openNewApp { app -> changed(app); open = app.id } }, icon = "Plus")
        list?.let { Txt(t("apps.portal.count", "count" to it.size, "max" to 25), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted) }
    }
    SectionHeading(t("apps.portal.yourApps"))
    when {
        failed -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(t("apps.portal.couldNotLoad"), style = Nx.type.body, color = c.textMuted)
            NxButton(t("invite.tryAgain"), { attempt++ }, kind = fish.nexa.ui.components.ButtonKind.SECONDARY)
        }
        list == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Spinner() }
        list!!.isEmpty() -> Column(
            Modifier
                .fillMaxWidth()
                .sunken(Radii.Lg, c, mixOklab(c.bgBase, c.bgRaised, 0.5f))
                .border(1.dp, c.borderSubtle, Radii.Lg)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(48.dp).clip(Radii.Md).background(brandGradient(c)), contentAlignment = Alignment.Center) { Icon("Bot", c.onBrand, size = 24.dp) }
            Txt(t("apps.portal.empty"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(20f)), color = c.textSubtle)
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (app in list!!) AppRow(app) { open = app.id }
        }
    }
    SectionHeading(t("apps.portal.connect"))
    Txt(t("apps.portal.connectHint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(19.6f)), color = c.textMuted, modifier = Modifier.padding(bottom = 12.dp))
    LibrarySnippets(portalBase())
}

/** Where an app is: how many servers and accounts it is in, each said on its own. */
private fun reach(app: OwnedApp): List<String> {
    if (app.serverCount == 0 && app.userInstallCount == 0) return listOf(t("apps.portal.nowhere"))
    return buildList {
        if (app.serverCount > 0) add(t("apps.portal.inServers", "count" to app.serverCount))
        if (app.userInstallCount > 0) add(t("apps.portal.onAccounts", "count" to app.userInstallCount))
    }
}

/** One app in the list: its picture, its name (and the mark of one that reads every message), where it is. */
@Composable
private fun AppRow(app: OwnedApp, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Md
    Row(
        Modifier
            .fillMaxWidth()
            .ring(shape, if (pressed) c.border else c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        AppPicture(app, 40)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Txt(app.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(16f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                if (app.intents.messageContent) Row(
                    Modifier.background(c.warning.copy(alpha = 0.14f), RoundedCornerShape(999.dp)).padding(horizontal = 7.dp, vertical = 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon("TriangleAlert", c.textWarning, size = 11.dp)
                    Txt(t("apps.portal.readsEverything"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f), fontWeight = FontWeight(650)), color = c.textWarning, maxLines = 1)
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (part in reach(app)) Txt(part, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
            }
        }
        Icon("ChevronRight", c.icon, size = 18.dp, modifier = Modifier.graphicsLayer { if (fish.nexa.ui.I18n.rtl) scaleX = -1f })
    }
}

/** An app's picture: its own icon, else its bot's, else the letters of its name. */
@Composable
fun AppPicture(app: OwnedApp, size: Int, square: Boolean = false) {
    // its icon, else its bot's avatar, else its letters (web components/apps/AppIcon.tsx; square is Avatar.module.css .square)
    Avatar(app.id, app.name, app.iconId ?: app.bot.avatarId, size.dp, icon = app.iconId != null, shape = if (square) SQUARE_AVATAR else CircleShape)
}

/**
 * Making an app: its name first, then its bot's token, shown this once under
 * the app's name. The app opens behind the token, so however the sheet is
 * closed the app is there (the web opens it as its dialog closes).
 */
private fun openNewApp(onMade: (OwnedApp) -> Unit) {
    var name by mutableStateOf("")
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var made by mutableStateOf<Pair<OwnedApp, String>?>(null)
    fun create() {
        val n = name.trim()
        if (n.codePointCount(0, n.length) < 2 || busy) return
        busy = true
        error = null
        // on the main thread, as the sheet's state and the page's are changed here (the request itself goes out on IO)
        Nexa.scope.launch(kotlinx.coroutines.Dispatchers.Main) {
            try {
                val res = Apps.create(n)
                made = res
                onMade(res.first)
            } catch (e: Exception) {
                error = describeError(e, t("apps.portal.createFailed"))
            } finally {
                busy = false
            }
        }
    }
    openSheet("new-app", heading = {
        val done = made
        if (done == null) SheetTitle(t("apps.portal.newApp"))
        else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SheetTitle(done.first.name, Modifier.weight(1f, fill = false))
            HookTags(null, app = true)
        }
    }, footer = { close ->
        if (made == null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("apps.cancel"), { close() }, kind = fish.nexa.ui.components.ButtonKind.SECONDARY)
            NxButton(t("apps.portal.create"), { create() }, loading = busy, enabled = name.trim().length >= 2)
        }
    }) { close ->
        val c = Nx.colors
        val done = made
        if (done == null) {
            NxTextField(
                name, { name = it.take(32); error = null }, label = t("apps.portal.name"), required = true, hint = t("apps.portal.nameHint"), error = error, capitalize = true,
                imeAction = androidx.compose.ui.text.input.ImeAction.Done, onIme = { create() },
            )
        } else {
            Txt(t("apps.portal.madeIntro"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f)), color = c.textSubtle)
            SecretReveal(done.second, t("apps.portal.tokenNote")) { close() }
        }
    }
}
