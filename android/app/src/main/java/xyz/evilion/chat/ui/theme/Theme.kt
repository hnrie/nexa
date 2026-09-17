package xyz.evilion.chat.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * The web client's design tokens (web/src/styles/tokens.css), so the two apps
 * are the same product rather than two that happen to share a server.
 */
@Immutable
data class ChatColors(
    val bgBase: Color,
    val bgRaised: Color,
    val bgSurface: Color,
    val bgFloating: Color,
    val bgInput: Color,
    val bgComposer: Color,
    val bgHover: Color,
    val bgSelected: Color,
    val bgActive: Color,
    val bgMessageHover: Color,
    val bgOverlay: Color,
    val text: Color,
    val textStrong: Color,
    val textSubtle: Color,
    val textMuted: Color,
    val textChannel: Color,
    val textPlaceholder: Color,
    val icon: Color,
    val brand: Color,
    val brandHover: Color,
    val brandActive: Color,
    val onBrand: Color,
    val link: Color,
    val textBrand: Color,
    val mentionBg: Color,
    val mentionBgHover: Color,
    val mentionFg: Color,
    val positive: Color,
    val positiveHover: Color,
    val warning: Color,
    val danger: Color,
    val dangerHover: Color,
    val statusOnline: Color,
    val statusIdle: Color,
    val statusDnd: Color,
    val statusOffline: Color,
    val borderSubtle: Color,
    val border: Color,
    val borderStrong: Color,
    val spoiler: Color,
    val spoilerRevealed: Color,
    val codeBg: Color,
    val embedBg: Color,
    val isDark: Boolean,
)

val DarkColors = ChatColors(
    bgBase = Color(0xFF2C2D32),
    bgRaised = Color(0xFF323339),
    bgSurface = Color(0xFF393A41),
    bgFloating = Color(0xFF34353B),
    bgInput = Color(0xFF242429),
    bgComposer = Color(0xFF393A41),
    bgHover = Color(0x1497979F),
    bgSelected = Color(0x1F97979F),
    bgActive = Color(0x2997979F),
    bgMessageHover = Color(0x0F97979F),
    bgOverlay = Color(0xB3000000),
    text = Color(0xFFF3F3F4),
    textStrong = Color(0xFFFFFFFF),
    textSubtle = Color(0xFFC5C6CA),
    textMuted = Color(0xFFABACB2),
    textChannel = Color(0xFF999AA1),
    textPlaceholder = Color(0xFF6C6D76),
    icon = Color(0xFFB5BAC1),
    brand = Color(0xFF8000FF),
    brandHover = Color(0xFF6A00D6),
    brandActive = Color(0xFF5600AC),
    onBrand = Color(0xFFFFFFFF),
    link = Color(0xFF76AFF6),
    textBrand = Color(0xFFC3A0FF),
    mentionBg = Color(0x428000FF),
    mentionBgHover = Color(0x6B8000FF),
    mentionFg = Color(0xFFDDC9FF),
    positive = Color(0xFF3D9E60),
    positiveHover = Color(0xFF2F7F4C),
    warning = Color(0xFFFDB833),
    danger = Color(0xFFDA3E44),
    dangerHover = Color(0xFFB5343A),
    statusOnline = Color(0xFF3D9E60),
    statusIdle = Color(0xFFF0B232),
    statusDnd = Color(0xFFDA3E44),
    statusOffline = Color(0xFF82838B),
    borderSubtle = Color(0x1F97979F),
    border = Color(0x3397979F),
    borderStrong = Color(0x7097979F),
    spoiler = Color(0xFF7D7E87),
    spoilerRevealed = Color(0xFF242429),
    codeBg = Color(0xFF242429),
    embedBg = Color(0xFF393A41),
    isDark = true,
)

/**
 * Ash and Onyx, the same two the web client offers.
 *
 * The theme is kept with the account, so picking one on a phone picks it in
 * the browser too. Both used to fall through to Dark here while the browser
 * changed, which is a confusing way to find out a setting did nothing.
 * Transcribed from web/src/styles/tokens.css.
 */
val AshColors = DarkColors.copy(
    bgBase = Color(0xFF1A1A1E),
    bgRaised = Color(0xFF232428),
    bgSurface = Color(0xFF27272C),
    bgFloating = Color(0xFF2B2C30),
    bgInput = Color(0xFF131416),
    bgComposer = Color(0xFF27272C),
    text = Color(0xFFEFEFF1),
    textMuted = Color(0xFF96979E),
    textChannel = Color(0xFF81828A),
    spoilerRevealed = Color(0xFF1A1A1E),
    codeBg = Color(0xFF131416),
    embedBg = Color(0xFF27272C),
)

val OnyxColors = DarkColors.copy(
    bgBase = Color(0xFF000000),
    bgRaised = Color(0xFF000000),
    bgSurface = Color(0xFF131416),
    bgFloating = Color(0xFF16171A),
    bgInput = Color(0xFF0D0D0F),
    bgComposer = Color(0xFF131416),
    bgHover = Color(0x0FFFFFFF),
    bgSelected = Color(0x1AFFFFFF),
    bgActive = Color(0x24FFFFFF),
    bgMessageHover = Color(0x0AFFFFFF),
    text = Color(0xFFD4D5D8),
    textStrong = Color(0xFFFFFFFF),
    textMuted = Color(0xFF81828A),
    textChannel = Color(0xFF7A7B83),
    borderSubtle = Color(0x1AFFFFFF),
    spoilerRevealed = Color(0xFF131416),
    codeBg = Color(0xFF0D0D0F),
    embedBg = Color(0xFF131416),
)

val LightColors = ChatColors(
    bgBase = Color(0xFFF3F3F4),
    bgRaised = Color(0xFFFFFFFF),
    bgSurface = Color(0xFFEBECED),
    bgFloating = Color(0xFFFFFFFF),
    bgInput = Color(0xFFEBECED),
    bgComposer = Color(0xFFEBECED),
    bgHover = Color(0x1A6B6D76),
    bgSelected = Color(0x296B6D76),
    bgActive = Color(0x386B6D76),
    bgMessageHover = Color(0x0F6B6D76),
    bgOverlay = Color(0x8C000000),
    text = Color(0xFF2E2E34),
    textStrong = Color(0xFF28282D),
    textSubtle = Color(0xFF595A63),
    textMuted = Color(0xFF6C6D76),
    textChannel = Color(0xFF666770),
    textPlaceholder = Color(0xFF84858D),
    icon = Color(0xFF4E5058),
    brand = Color(0xFF8000FF),
    brandHover = Color(0xFF6A00D6),
    brandActive = Color(0xFF5600AC),
    onBrand = Color(0xFFFFFFFF),
    link = Color(0xFF006DD4),
    textBrand = Color(0xFF6A00D6),
    mentionBg = Color(0x428000FF),
    mentionBgHover = Color(0x6B8000FF),
    mentionFg = Color(0xFF4A1A8F),
    positive = Color(0xFF269153),
    positiveHover = Color(0xFF1F7A45),
    warning = Color(0xFFBB7300),
    danger = Color(0xFFD6363F),
    dangerHover = Color(0xFFB52D35),
    statusOnline = Color(0xFF269153),
    statusIdle = Color(0xFFF0B232),
    statusDnd = Color(0xFFD6363F),
    statusOffline = Color(0xFF8F9097),
    borderSubtle = Color(0x4797979F),
    border = Color(0x6697979F),
    borderStrong = Color(0x8597979F),
    spoiler = Color(0xFF8F9097),
    spoilerRevealed = Color(0xFFEBECED),
    // not bgBase: a code block or an embed drawn the same colour as the page
    // behind it loses every edge it has
    codeBg = Color(0xFFFFFFFF),
    embedBg = Color(0xFFFFFFFF),
    isDark = false,
)

val LocalChatColors = staticCompositionLocalOf { DarkColors }

/** Corner radii, matching the web app's --radius-* scale. */
object Radius {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
}

private val AppTypography = Typography(
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 15.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 18.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 11.sp, fontWeight = FontWeight.SemiBold),
)

/** The palette a saved theme name means; "system" follows the phone. */
@Composable
fun paletteFor(name: String): ChatColors = when (name) {
    "light" -> LightColors
    "ash" -> AshColors
    "onyx" -> OnyxColors
    "system" -> if (isSystemInDarkTheme()) DarkColors else LightColors
    else -> DarkColors
}

@Composable
fun NexaTheme(colors: ChatColors, content: @Composable () -> Unit) {
    val dark = colors.isDark
    val scheme = if (dark) {
        darkColorScheme(
            primary = colors.brand,
            onPrimary = colors.onBrand,
            secondary = colors.brand,
            background = colors.bgBase,
            onBackground = colors.text,
            surface = colors.bgRaised,
            onSurface = colors.text,
            surfaceVariant = colors.bgSurface,
            onSurfaceVariant = colors.textMuted,
            error = colors.danger,
            outline = colors.border,
        )
    } else {
        lightColorScheme(
            primary = colors.brand,
            onPrimary = colors.onBrand,
            secondary = colors.brand,
            background = colors.bgBase,
            onBackground = colors.text,
            surface = colors.bgRaised,
            onSurface = colors.text,
            surfaceVariant = colors.bgSurface,
            onSurfaceVariant = colors.textMuted,
            error = colors.danger,
            outline = colors.border,
        )
    }
    val context = LocalContext.current
    SideEffect {
        context.findActivity()?.window?.let { window ->
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !dark
        }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalChatColors provides colors) {
        MaterialTheme(colorScheme = scheme, typography = AppTypography, content = content)
    }
}

private fun android.content.Context.findActivity(): Activity? {
    var ctx: android.content.Context? = this
    while (ctx is android.content.ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

/** Shorthand for the palette inside composables. */
val chatColors: ChatColors
    @Composable get() = LocalChatColors.current
