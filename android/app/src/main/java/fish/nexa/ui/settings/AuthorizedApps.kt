package fish.nexa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.AppCommands
import fish.nexa.data.Apps
import fish.nexa.net.AuthorizedApp
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.apps.scopeWords
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
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

/**
 * Settings, Authorized Apps (web components/settings/AuthorizedAppsPage.tsx):
 * the apps this account let in, on itself rather than on a server, with what
 * each may do, and a way to take it back.
 */
@Composable
fun AuthorizedAppsPage() {
    val c = Nx.colors
    var list by remember { mutableStateOf<List<AuthorizedApp>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            list = Apps.authorized()
        } catch (_: Exception) {
            failed = true
        }
    }
    fun remove(a: AuthorizedApp) = fish.nexa.ui.shell.confirm(
        t("apps.authorized.removeNamed", "name" to a.application.name),
        t("apps.authorized.removeBody", "name" to a.application.name),
        t("apps.authorized.remove"),
    ) {
        try {
            Apps.deauthorize(a.application.id)
            list = list?.filter { it.application.id != a.application.id }
            AppCommands.forget()
            Nexa.ui.toast(t("apps.authorized.removed", "name" to a.application.name), "success")
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("apps.authorized.removeFailed")), "error")
        }
    }
    PageTitle(t("apps.authorized.title"))
    Txt(t("apps.authorized.intro"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f)), color = c.textSubtle, modifier = Modifier.padding(bottom = 18.dp))
    val l = list
    when {
        failed -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(t("apps.authorized.couldNotLoad"), style = Nx.type.body, color = c.textMuted)
            NxButton(t("invite.tryAgain"), { attempt++ }, kind = ButtonKind.SECONDARY)
        }
        l == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Spinner() }
        l.isEmpty() -> Column(
            Modifier.fillMaxWidth().sunken(Radii.Lg, c, mixOklab(c.bgBase, c.bgRaised, 0.5f)).border(1.dp, c.borderSubtle, Radii.Lg).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(48.dp).clip(Radii.Md).background(brandGradient(c)), contentAlignment = Alignment.Center) { Icon("AppWindow", c.onBrand, size = 24.dp) }
            Txt(t("apps.authorized.none"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(20f)), color = c.textSubtle)
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (a in l) {
                val shape = Radii.Md
                Row(
                    Modifier.fillMaxWidth().ring(shape, c.borderSubtle).background(c.bgSurface, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight).padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(a.application.id, a.application.name, a.application.iconId ?: a.application.bot?.avatarId, 40.dp, icon = a.application.iconId != null)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                            Txt(a.application.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                            HookTags(null, app = true)
                        }
                        val words = scopeWords(a.scopes, a.installed)
                        if (words.isNotEmpty()) Txt(words.joinToString(" "), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17f)), color = c.textMuted)
                        Txt(t("apps.authorized.since", "date" to Time.shortDate(a.authorizedAt)), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                    }
                    NxButton(t("apps.authorized.remove"), { remove(a) }, kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH)
                }
            }
        }
    }
}
