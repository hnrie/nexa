package fish.nexa.ui.media

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.data.HookContent
import fish.nexa.media.Media
import fish.nexa.media.mediaSrc
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx

/**
 * HookAvatar: a webhook message's picture, the one it was sent with through
 * the media proxy; else the webhook's own; else the letters of its name, as
 * anyone without a picture gets.
 */
@Composable
fun HookAvatar(hook: HookContent, webhookId: String, size: Dp, modifier: Modifier = Modifier) {
    var broken by remember(hook.avatarProxyUrl) { mutableStateOf(false) }
    val proxy = hook.avatarProxyUrl?.takeIf { !broken }
    val src = mediaSrc(proxy)
    when {
        proxy != null && !src.isNullOrEmpty() ->
            AsyncImage(src, null, imageLoader = Media.loader, contentScale = ContentScale.Crop, onError = { broken = true }, modifier = modifier.size(size).clip(CircleShape))
        // the link is being re-signed: its place is kept rather than flashing letters first
        proxy != null && src == "" -> Box(modifier.size(size))
        else -> Avatar(webhookId, hook.name, hook.avatarId, size, modifier)
    }
}

/** The tag beside a webhook's name. */
@Composable
fun AppTag() {
    val c = Nx.colors
    Box(Modifier.height(15.dp).background(c.brand, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
        Txt(
            t("webhook.appTag").uppercase(),
            style = Nx.type.label.copy(fontSize = Nx.type.sp(10f), lineHeight = Nx.type.sp(15f), fontWeight = FontWeight(600), letterSpacing = 0.02.em),
            color = c.onBrand,
            maxLines = 1,
        )
    }
}

/** HookTags: the APP tag and the mark that says webhook messages are not end-to-end encrypted; the mark opens the card. */
@Composable
fun HookTags(onOpen: () -> Unit) {
    AppTag()
    Icon(
        "LockOpen", Nx.colors.textMuted, size = 14.dp, label = t("webhook.notEncryptedHint"),
        modifier = Modifier.pressable(remember { MutableInteractionSource() }, onClick = onOpen),
    )
}

/**
 * HookPopout: what a tap on a webhook's name or picture opens. There is no
 * person to show a profile of, so the card says what the sender is, and that
 * what it posts is not end-to-end encrypted.
 */
fun openHookCard(hook: HookContent, webhookId: String) {
    openSheet("hook-card", closeButton = false) {
        val c = Nx.colors
        Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HookAvatar(hook, webhookId, 56.dp)
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Txt(
                        hook.name,
                        style = Nx.type.heading.copy(fontSize = Nx.type.sp(19f), lineHeight = Nx.type.sp(24f), fontWeight = FontWeight(690), letterSpacing = (-0.006).em),
                        color = c.textStrong,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    AppTag()
                }
            }
            Txt(
                if (hook.source == "github") t("webhook.popoutGitHub") else t("webhook.popoutBody"),
                style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(18f)),
                color = c.textSubtle,
            )
            CardNote("LockOpen", t("webhook.popoutNotEncrypted"))
            CardNote("Webhook", t("webhook.popoutManage"))
        }
    }
}

@Composable
private fun CardNote(icon: String, text: String) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.bgSurface, shape)
            .border(1.dp, c.borderSubtle, shape)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, c.textMuted, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17f)), color = c.textMuted)
    }
}
