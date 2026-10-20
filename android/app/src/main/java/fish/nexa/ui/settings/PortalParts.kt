package fish.nexa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch

/*
 * The Developer Portal's small parts (web components/settings/portal/
 * portalParts.tsx): ids and keys with Copy, a secret shown this once, the
 * password asked for before something that cannot be taken back, and the
 * lines that point bot libraries at this server.
 */

/** This server's own address, which bot libraries are pointed at and install links start with. */
fun portalBase(): String = fish.nexa.ui.markdown.AppLinks.shareOrigin(Nexa.api.baseUrl).trimEnd('/')

/** Copies something and says so. */
fun copyAndSay(context: android.content.Context, value: String, said: String = t("apps.portal.copied"), sensitive: Boolean = false) {
    if (copyText(context, value, sensitive) && android.os.Build.VERSION.SDK_INT < 33) Nexa.ui.toast(said, "success")
}

/** A small button that copies something and says so. */
@Composable
fun CopyButton(value: String, label: String, done: String = t("apps.portal.copied")) {
    val c = Nx.colors
    val context = LocalContext.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(36.dp)
            .clip(Radii.Xs)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .pressable(interaction) { copyAndSay(context, value, done) }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon("Copy", if (pressed) c.textStrong else c.icon, size = 15.dp) }
}

/** An id or a key someone copies into their code: its name, the value, and Copy. */
@Composable
fun IdChip(label: String, value: String) {
    val c = Nx.colors
    Row(
        Modifier
            .clip(Radii.Sm)
            .background(c.bgInput, Radii.Sm)
            .border(1.dp, c.borderSubtle, Radii.Sm)
            .padding(start = 9.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Txt(label, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
        Txt(value, style = Nx.type.code.copy(fontSize = Nx.type.sp(12.5f)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
        CopyButton(value, t("apps.portal.copyNamed", "name" to label))
    }
}

/**
 * A secret shown this once (a bot's token, an app's client secret): set into
 * the page with Copy, and what it is for. It is not kept anywhere to show
 * again: lose it, and it can only be reset.
 */
@Composable
fun SecretReveal(value: String, note: String, onDone: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .ring(shape, c.positive.copy(alpha = 0.4f))
            .background(mixSrgb(c.bgSurface, c.positive, 0.07f), shape)
            .topEdge(shape, c.edgeLight)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SelectionContainer {
            Txt(
                value,
                style = Nx.type.code.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19f)),
                color = c.textStrong,
                modifier = Modifier.fillMaxWidth().sunken(Radii.Sm, c).border(1.dp, c.borderSubtle, Radii.Sm).padding(12.dp),
            )
        }
        Txt(note, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18f)), color = c.textSubtle)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NxButton(
                if (copied) t("apps.portal.copiedShort") else t("apps.portal.copy"),
                {
                    copyAndSay(context, value, sensitive = true)
                    copied = true
                },
                size = ButtonSize.TOUCH,
                icon = if (copied) "Check" else "Copy",
            )
            NxButton(t("apps.portal.done"), onDone, kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH)
        }
    }
}

/**
 * Asks for the account's password before something that cannot be taken
 * back: a new token or secret (the old one stops working), deleting an app.
 * The password never leaves the device; what is sent is proof of it.
 */
fun openPasswordConfirm(title: String, body: String, confirm: String, danger: Boolean = false, run: suspend (authKey: String) -> Unit) {
    var password by mutableStateOf("")
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    // the button, or the keyboard's own (Enter sends the web's form)
    fun go(close: () -> Unit) {
        if (password.isEmpty() || busy) return
        busy = true
        error = null
        // on the main thread, as the sheet's state is changed here; the password is stretched on Default
        Nexa.scope.launch(kotlinx.coroutines.Dispatchers.Main) {
            try {
                run(fish.nexa.crypto.Bytes.b64(Nexa.auth.currentAuthKey(password)))
                close()
            } catch (e: Exception) {
                error = describeError(e, t("apps.portal.failed"))
                busy = false
            }
        }
    }
    openSheet("password-confirm", title = title, footer = { close ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("apps.cancel"), { close() }, kind = ButtonKind.SECONDARY)
            NxButton(confirm, { go(close) }, kind = if (danger) ButtonKind.DANGER else ButtonKind.PRIMARY, loading = busy, enabled = password.isNotEmpty())
        }
    }) { close ->
        val c = Nx.colors
        Txt(body, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f)), color = c.textSubtle)
        NxTextField(
            password, { password = it; error = null }, label = t("apps.portal.password"), password = true, error = error,
            imeAction = androidx.compose.ui.text.input.ImeAction.Done, onIme = { go(close) },
        )
    }
}

/** A link built from choices, ready to copy. */
@Composable
fun GeneratedLink(link: String) {
    val c = Nx.colors
    Row(
        Modifier.fillMaxWidth().sunken(Radii.Md, c).border(1.dp, c.borderSubtle, Radii.Md).padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SelectionContainer(Modifier.weight(1f).padding(top = 8.dp)) {
            Txt(link, style = Nx.type.code.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(19f)), color = c.text)
        }
        CopyButton(link, t("apps.portal.copyLink"), t("apps.portal.linkCopied"))
    }
}

/** The lines that point each bot library at this server. */
private fun snippet(lib: String, base: String): String {
    val ws = base.replaceFirst(Regex("^http"), "ws")
    return when (lib) {
        "py" -> listOf(
            "import discord",
            "import yarl",
            "",
            "BASE = \"$base\"",
            "discord.http.Route.BASE = BASE + \"/api/v10\"",
            "discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL(\"$ws/bot-gateway/\")",
            "discord.Asset.BASE = BASE + \"/cdn\"",
        ).joinToString("\n")
        "js" -> listOf(
            "const { Client, GatewayIntentBits } = require(\"discord.js\");",
            "",
            "const client = new Client({",
            "  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],",
            "  rest: { api: \"$base/api\", cdn: \"$base/cdn\" },",
            "});",
        ).joinToString("\n")
        "go" -> listOf(
            "const base = \"$base\"",
            "",
            "func pointAtNexa() {",
            "\tapi := base + \"/api/v\" + discordgo.APIVersion + \"/\"",
            "\tdiscordgo.EndpointDiscord = base + \"/\"",
            "\tdiscordgo.EndpointAPI = api",
            "\tdiscordgo.EndpointGuilds = api + \"guilds/\"",
            "\tdiscordgo.EndpointChannels = api + \"channels/\"",
            "\tdiscordgo.EndpointUsers = api + \"users/\"",
            "\tdiscordgo.EndpointGateway = api + \"gateway\"",
            "\tdiscordgo.EndpointGatewayBot = discordgo.EndpointGateway + \"/bot\"",
            "\tdiscordgo.EndpointWebhooks = api + \"webhooks/\"",
            "\tdiscordgo.EndpointStickers = api + \"stickers/\"",
            "\tdiscordgo.EndpointApplications = api + \"applications\"",
            "\tdiscordgo.EndpointOAuth2 = api + \"oauth2/\"",
            "\tdiscordgo.EndpointOAuth2Applications = discordgo.EndpointOAuth2 + \"applications\"",
            "\tcdn := base + \"/cdn/\"",
            "\tdiscordgo.EndpointCDN = cdn",
            "\tdiscordgo.EndpointCDNAttachments = cdn + \"attachments/\"",
            "\tdiscordgo.EndpointCDNAvatars = cdn + \"avatars/\"",
            "\tdiscordgo.EndpointCDNIcons = cdn + \"icons/\"",
            "\tdiscordgo.EndpointCDNBanners = cdn + \"banners/\"",
            "\tdiscordgo.EndpointCDNGuilds = cdn + \"guilds/\"",
            "\tdiscordgo.EndpointCDNRoleIcons = cdn + \"role-icons/\"",
            "}",
        ).joinToString("\n")
        else -> listOf("API      $base/api/v10", "Gateway  $ws/bot-gateway", "CDN      $base/cdn", "OAuth2   $base/oauth2/authorize").joinToString("\n")
    }
}

/**
 * How to point a bot library at this server: the few lines that change, for
 * the libraries people use most, and the addresses for any other.
 */
@Composable
fun LibrarySnippets(base: String) {
    val c = Nx.colors
    var lib by remember { mutableStateOf("py") }
    val tabs = listOf("py" to "discord.py", "js" to "discord.js", "go" to "discordgo", "other" to t("apps.portal.otherLibraries"))
    val code = snippet(lib, base)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FlowRow(
            Modifier.sunken(Radii.Md, c).padding(4.dp).semantics { contentDescription = t("apps.portal.libraries") },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((id, label) in tabs) {
                val on = id == lib
                Box(
                    Modifier
                        .clip(Radii.Sm)
                        .then(if (on) Modifier.background(c.bgSurface, Radii.Sm).background(sheen(c), Radii.Sm).ring(Radii.Sm, c.borderSubtle).topEdge(Radii.Sm, c.edgeLight) else Modifier)
                        .pressable(remember(id) { MutableInteractionSource() }, role = androidx.compose.ui.semantics.Role.Tab) { lib = id }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) { Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.textMuted, maxLines = 1) }
            }
        }
        Box(Modifier.fillMaxWidth().clip(Radii.Md).background(c.codeBg, Radii.Md).border(1.dp, c.codeBorder, Radii.Md)) {
            Box(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 52.dp, top = 14.dp, bottom = 14.dp)) {
                SelectionContainer {
                    Txt(code, style = Nx.type.code.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(20f)), color = c.text, modifier = Modifier.widthIn(min = 200.dp))
                }
            }
            Box(Modifier.align(Alignment.TopEnd).padding(8.dp).clip(Radii.Xs).background(c.bgSurface).border(1.dp, c.borderSubtle, Radii.Xs)) {
                CopyButton(code, t("apps.portal.copyCode"))
            }
        }
        Txt(
            when (lib) {
                "other" -> t("apps.portal.otherNote")
                "js" -> t("apps.portal.jsNote")
                else -> t("apps.portal.libNote")
            },
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19f)), color = c.textMuted,
        )
    }
}
