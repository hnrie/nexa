package fish.nexa.ui.voice

import android.icu.text.MeasureFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.I18n
import fish.nexa.ui.Icon
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.LocalColors
import fish.nexa.ui.theme.NexaColors
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Palettes
import fish.nexa.voice.Voice

/**
 * The call stage is dark in every theme (Voice.module.css `data-dark-scope`):
 * in the light theme its surfaces and text take the dark palette's, and the
 * accent stays the account's own.
 */
@Composable
fun DarkScope(content: @Composable () -> Unit) {
    val cur = Nx.colors
    val colors: NexaColors = if (!cur.isLight) cur else Palettes.dark.copy(
        brand = cur.brand,
        brandHover = cur.brandHover,
        brandActive = cur.brandActive,
        onBrand = cur.onBrand,
        link = cur.link,
        textBrand = cur.textBrand,
    )
    CompositionLocalProvider(LocalColors provides colors, content = content)
}

/**
 * A person in a call, by the name the place shows them by (VoiceView.tsx's
 * nameOf): a server nickname, their name, a guest's chosen name, and "You" only
 * for this account while its own profile has not loaded.
 */
fun callName(userId: String, channelId: String?): String {
    val serverId = channelId?.let { Nexa.channels.get(it)?.serverId }
    val nick = serverId?.let { Nexa.servers.get(it)?.members?.get(userId)?.nickname }?.takeIf { it.isNotBlank() }
    if (nick != null) return nick
    val u = Nexa.users.get(userId)
    if (u != null) return Names.display(u)
    return Nexa.voiceStates.byUser.value[userId]?.user?.displayName?.takeIf { it.isNotBlank() }
        ?: if (userId == Nexa.users.meId) t("callScreen.you") else t("names.unknownUser")
}

/** The avatar picture id for someone in a call, guests included. */
fun callAvatar(userId: String): String? = Nexa.users.get(userId)?.avatarId ?: Nexa.voiceStates.byUser.value[userId]?.user?.avatarId

fun isGuestUser(userId: String): Boolean = Voice.isGuest(Nexa.voiceStates.byUser.value[userId]) || ((Nexa.users.get(userId)?.flags ?: 0L) and Voice.GUEST_FLAG) != 0L

/** The hang-up glyph: a handset turned down (HangUp.tsx), centred in its box. */
@Composable
fun HangUpIcon(tint: Color, size: Dp = 22.dp, modifier: Modifier = Modifier) {
    Icon("Phone", tint, modifier = modifier.rotate(135f), size = size)
}

/** A round trip in the reader's language: "12 ms". */
fun formatRtt(ms: Double): String = try {
    MeasureFormat.getInstance(I18n.locale, MeasureFormat.FormatWidth.SHORT).format(Measure(Math.round(ms), MeasureUnit.MILLISECOND))
} catch (_: Exception) {
    "${Math.round(ms)} ms"
}

/** "45 seconds", "12 minutes", "1 hour, 5 minutes" (callSummary.ts formatCallLength). */
fun formatCallLength(seconds: Long): String {
    val s = maxOf(1L, seconds)
    return try {
        val f = MeasureFormat.getInstance(I18n.locale, MeasureFormat.FormatWidth.WIDE)
        if (s < 60) return f.format(Measure(s, MeasureUnit.SECOND))
        val m = Math.round(s / 60.0)
        if (m < 60) return f.format(Measure(m, MeasureUnit.MINUTE))
        val h = m / 60
        val rest = m % 60
        if (rest == 0L) f.format(Measure(h, MeasureUnit.HOUR)) else f.formatMeasures(Measure(h, MeasureUnit.HOUR), Measure(rest, MeasureUnit.MINUTE))
    } catch (_: Exception) {
        "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}
