package fish.nexa.ui.apps

import android.os.Build
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge

/**
 * What an app can read, shown rather than told (web
 * components/apps/ReadingGlass.tsx): four lines of a conversation, where what
 * the app cannot open is sealed and what is meant for it (a mention of it, a
 * reply to it) is plain. An app that reads every message (the Message Content
 * intent) unseals them all, and the glass says what that costs: the server
 * opens those messages for it, so they are not end-to-end encrypted from it.
 *
 * With `onChange` it is the choice itself, in the Developer Portal; without,
 * it states how an app is, wherever someone decides about it.
 */
@Composable
fun ReadingGlass(name: String, everything: Boolean, modifier: Modifier = Modifier, compact: Boolean = false, onChange: ((Boolean) -> Unit)? = null) {
    val c = Nx.colors
    val shape = if (compact) Radii.Md else Radii.Lg
    Column(
        modifier
            .fillMaxWidth()
            .then(
                // reading everything is a cost: the panel is lit warm along its edge
                if (everything) Modifier.boxShadow(shape, 10f, 30f, c.warning.copy(alpha = 0.7f), spread = -14f).ring(shape, c.warning.copy(alpha = 0.6f))
                else Modifier.shadowMedium(shape, c).ring(shape, c.panelEdge),
            )
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .padding(horizontal = if (compact) 14.dp else 16.dp, vertical = if (compact) 12.dp else 16.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 14.dp),
    ) {
        if (onChange != null) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GlassChoice(!everything, warn = false, t("apps.glass.addressed"), t("apps.glass.addressedDesc")) { onChange(false) }
                GlassChoice(everything, warn = true, t("apps.glass.everything"), t("apps.glass.everythingDesc")) { onChange(true) }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (everything) "TriangleAlert" else "Eye", if (everything) c.textWarning else c.textBrand, size = 16.dp)
                Txt(
                    if (everything) t("apps.glass.readsEverything", "app" to name) else t("apps.glass.readsAddressed", "app" to name),
                    style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.text,
                )
            }
        }
        // the conversation itself, set into the panel; it shows, it says nothing to TalkBack (the note does)
        Column(
            Modifier
                .fillMaxWidth()
                .sunken(Radii.Md, c)
                .border(1.dp, c.borderSubtle, Radii.Md)
                .padding(horizontal = if (compact) 12.dp else 14.dp, vertical = if (compact) 10.dp else 12.dp)
                .clearAndSetSemantics {},
            verticalArrangement = Arrangement.spacedBy(if (compact) 7.dp else 9.dp),
        ) {
            GlassLine(t("apps.glass.personA"), 1, t("apps.glass.line1"), open = everything)
            GlassLine(t("apps.glass.personB"), 2, t("apps.glass.line2", "app" to name), open = true)
            GlassLine(t("apps.glass.personA"), 1, t("apps.glass.line3"), open = everything)
            GlassLine(t("apps.glass.personB"), 2, t("apps.glass.line4"), open = true, reply = true)
        }
        Txt(
            if (everything) t("apps.glass.everythingNote", "app" to name) else t("apps.glass.addressedNote", "app" to name),
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18f)),
            color = if (everything) c.textWarning else c.textMuted,
        )
    }
}

/** One line of the glass's conversation: who, and what they said, sealed unless the app can read it. */
@Composable
private fun GlassLine(who: String, tone: Int, words: String, open: Boolean, reply: Boolean = false) {
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    val seal by animateFloatAsState(if (open) 0f else 1f, if (reduced) tween(0) else tween(320, easing = Nx.motion.easeOut), label = "seal")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(18.dp).background(mixSrgb(c.bgSurface, if (tone == 1) c.statusIdle else c.link, 0.75f), CircleShape))
        Txt(who, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1)
        if (reply) Icon("CornerDownRight", c.textMuted, size = 13.dp)
        Box(Modifier.weight(1f, fill = false)) {
            // a phone that cannot blur gets the words struck out with a bar instead, so what is sealed still reads as sealed
            if (seal > 0.5f && Build.VERSION.SDK_INT < 31) {
                Box(Modifier.padding(vertical = 4.dp).fillMaxWidth(0.8f).height(10.dp).background(c.textMuted.copy(alpha = 0.35f), RoundedCornerShape(5.dp)))
            } else Txt(
                words,
                style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18f)),
                color = c.text,
                maxLines = 1,
                modifier = Modifier.alpha(1f - 0.35f * seal).then(if (seal > 0f) Modifier.blur((4.5f * seal).dp) else Modifier),
            )
        }
        if (!open) Icon("Lock", c.textMuted, size = 12.dp)
    }
}

/** One of the two answers to what an app reads, in the Developer Portal. */
@Composable
private fun GlassChoice(on: Boolean, warn: Boolean, label: String, description: String, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Md
    val tint = if (warn) c.warning else c.brand
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                if (on) Modifier.ring(shape, tint.copy(alpha = 0.8f), 2.dp).background(mixSrgb(c.bgSurface, tint, if (warn) 0.09f else 0.10f), shape).background(sheen(c), shape).topEdge(shape, c.edgeLight)
                else Modifier.sunken(shape, c, mixSrgb(c.bgBase, c.bgSurface, 0.55f)).border(1.dp, c.borderSubtle, shape),
            )
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, role = Role.RadioButton, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.padding(top = 2.dp).size(18.dp).border(2.dp, if (on) tint else c.borderStrong, CircleShape), contentAlignment = Alignment.Center) {
            if (on) Box(Modifier.size(9.dp).background(tint, CircleShape))
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(650)), color = c.textStrong)
            Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17f)), color = c.textMuted)
        }
    }
}

/**
 * Permissions as ticks, in the role editor's groups (web
 * components/apps/PermissionPicker.tsx): the ones an app's bot is given when
 * it is added. With `only`, just those are listed (what an app asks for, on
 * the consent page, where each can be taken away); without, every permission
 * is, for building an app's install link.
 */
@Composable
fun PermissionPicker(value: Long, onChange: (Long) -> Unit, only: Long? = null) {
    val c = Nx.colors
    val admin = value and fish.nexa.data.P.ADMINISTRATOR != 0L
    val groups = remember(only) {
        fish.nexa.ui.server.PermInfo.groups().map { g -> g.copy(items = g.items.filter { only == null || only and it.bit != 0L }) }.filter { it.items.isNotEmpty() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for (g in groups) Column {
            Txt(g.name, style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700)), color = c.textMuted, modifier = Modifier.padding(bottom = 6.dp))
            for (it in g.items) {
                val on = value and it.bit != 0L
                // under Administrator every other permission is had anyway
                val implied = admin && it.bit != fish.nexa.data.P.ADMINISTRATOR
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(Radii.Sm)
                        .pressable(remember(it.bit) { MutableInteractionSource() }, enabled = !implied, role = Role.Checkbox) { onChange(if (on) value and it.bit.inv() else value or it.bit) }
                        .semantics { selected = on || implied }
                        .alpha(if (implied) 0.7f else 1f)
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val ticked = on || implied
                    Box(
                        Modifier
                            .size(20.dp)
                            .then(if (ticked) Modifier.background(fish.nexa.ui.theme.brandGradient(c), RoundedCornerShape(6.dp)) else Modifier.border(2.dp, c.textMuted, RoundedCornerShape(6.dp))),
                        contentAlignment = Alignment.Center,
                    ) { if (ticked) Icon("Check", c.onBrand, size = 13.dp, stroke = 3f) }
                    Txt(it.label, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f)), color = c.text)
                }
            }
        }
    }
}
