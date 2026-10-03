package fish.nexa.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/** Radii from tokens.css (--radius-*). */
object Radii {
    val xs = 6.dp
    val sm = 10.dp
    val md = 14.dp
    val lg = 20.dp
    val xl = 28.dp
    val Xs = RoundedCornerShape(xs)
    val Sm = RoundedCornerShape(sm)
    val Md = RoundedCornerShape(md)
    val Lg = RoundedCornerShape(lg)
    val Xl = RoundedCornerShape(xl)
    val Pill = RoundedCornerShape(50)
}

/** Motion from tokens.css: quick to answer, soft to settle; nothing moves with Reduce Motion on. */
@Immutable
data class NexaMotion(val reduced: Boolean) {
    val easeOut = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val easeInOut = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)
    val spring = CubicBezierEasing(0.34f, 1.4f, 0.64f, 1f)
    val fast get() = if (reduced) 0 else 120
    val normal get() = if (reduced) 0 else 180
    val slow get() = if (reduced) 0 else 300
}

val LocalColors = staticCompositionLocalOf { Palettes.dark }
val LocalType = staticCompositionLocalOf { NexaType(NexaFonts.text, NexaFonts.display, NexaFonts.mono, 1f) }
val LocalMotion = staticCompositionLocalOf { NexaMotion(false) }
val LocalTextStyle = staticCompositionLocalOf { TextStyle.Default }

object Nx {
    val colors: NexaColors
        @Composable @ReadOnlyComposable get() = LocalColors.current
    val type: NexaType
        @Composable @ReadOnlyComposable get() = LocalType.current
    val motion: NexaMotion
        @Composable @ReadOnlyComposable get() = LocalMotion.current
}

@Composable
fun NexaTheme(
    colors: NexaColors,
    fontScale: Float = 1f,
    classic: Boolean = false,
    reducedMotion: Boolean = false,
    rtl: Boolean = false,
    content: @Composable () -> Unit,
) {
    val type = if (classic) NexaType(NexaFonts.classicText, NexaFonts.classicDisplay, NexaFonts.mono, fontScale)
    else NexaType(NexaFonts.text, NexaFonts.display, NexaFonts.mono, fontScale)
    CompositionLocalProvider(
        LocalColors provides colors,
        LocalType provides type,
        LocalMotion provides NexaMotion(reducedMotion),
        LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
        LocalTextStyle provides type.body.copy(color = colors.text),
        content = content,
    )
}
