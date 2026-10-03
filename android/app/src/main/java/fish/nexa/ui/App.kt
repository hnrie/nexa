package fish.nexa.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import fish.nexa.Nexa
import fish.nexa.data.AuthState
import fish.nexa.ui.auth.AuthFlow
import fish.nexa.ui.auth.CaptchaHost
import fish.nexa.ui.auth.LockScreen
import fish.nexa.ui.auth.OfflineScreen
import fish.nexa.ui.auth.Splash
import fish.nexa.ui.components.ToastHost
import fish.nexa.ui.shell.MainShell
import fish.nexa.ui.theme.NexaTheme
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Palettes
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The account's look, kept on this device too (the web's ec:appearance), so
 * the sign-in screen and the first frame are drawn in the right theme before
 * the encrypted settings arrive.
 */
object Appearance {
    private fun prefs() = Nexa.app.getSharedPreferences("appearance", Context.MODE_PRIVATE)

    data class Look(val theme: String, val accent: String?, val fontScale: Float, val reducedMotion: Boolean, val classic: Boolean)

    fun remembered(): Look = prefs().let { p ->
        Look(p.getString("theme", "dark") ?: "dark", p.getString("accent", null), p.getFloat("fontScale", 1f), p.getBoolean("reducedMotion", false), p.getBoolean("classic", false))
    }

    fun remember(l: Look) = prefs().edit()
        .putString("theme", l.theme).putString("accent", l.accent).putFloat("fontScale", l.fontScale)
        .putBoolean("reducedMotion", l.reducedMotion).putBoolean("classic", l.classic).apply()
}

@Composable
fun App() {
    val auth by Nexa.auth.state.collectAsState()
    val doc by Nexa.settings.doc.collectAsState()
    val loaded by Nexa.settings.loaded.collectAsState()
    val look = if (loaded && auth is AuthState.Ready) Appearance.Look(
        theme = (doc["theme"] as? JsonPrimitive)?.contentOrNull ?: "dark",
        accent = (doc["accent"] as? JsonPrimitive)?.contentOrNull,
        fontScale = ((doc["fontScale"] as? JsonPrimitive)?.doubleOrNull ?: 1.0).toFloat().coerceIn(0.75f, 1.5f),
        reducedMotion = (doc["reducedMotion"] as? JsonPrimitive)?.booleanOrNull ?: false,
        classic = (doc["fontFace"] as? JsonPrimitive)?.contentOrNull == "classic",
    ) else Appearance.remembered()
    LaunchedEffect(look, loaded) { if (loaded) Appearance.remember(look) }
    val locale = (doc["locale"] as? JsonPrimitive)?.contentOrNull
    LaunchedEffect(locale, loaded) {
        if (!loaded) return@LaunchedEffect
        I18n.use(locale)
        // the notification channels are named in the app's language
        fish.nexa.notify.Notifier.installChannels()
    }
    @Suppress("UNUSED_VARIABLE") val lang = I18n.tag

    NexaTheme(
        colors = Themes.resolve(look.theme, look.accent, androidx.compose.foundation.isSystemInDarkTheme()),
        fontScale = look.fontScale,
        classic = look.classic,
        reducedMotion = look.reducedMotion || Motion.systemOff(),
        rtl = I18n.rtl,
    ) {
        Box(Modifier.fillMaxSize().background(Nx.colors.bgCanvas)) {
            when (val s = auth) {
                AuthState.Loading -> Splash()
                AuthState.Anonymous -> AuthFlow()
                is AuthState.Locked -> LockScreen(s)
                is AuthState.Offline -> OfflineScreen(s)
                is AuthState.Ready -> MainShell()
            }
            CaptchaHost.Sheet()
            ToastHost()
        }
    }
}

/** The system's own "remove animations" switch counts as Reduce Motion. */
object Motion {
    fun systemOff(): Boolean = try {
        android.provider.Settings.Global.getFloat(Nexa.app.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (_: Exception) {
        false
    }
}

/** A theme name as the settings hold it ("dark", "system", a preset or custom id) to a palette. */
object Themes {
    fun resolve(name: String, accent: String?, systemDark: Boolean): fish.nexa.ui.theme.NexaColors {
        val doc = Nexa.settings.doc.value
        val base = when (name) {
            "system" -> {
                val sys = doc["systemThemes"] as? kotlinx.serialization.json.JsonObject
                val pick = (sys?.get(if (systemDark) "dark" else "light") as? JsonPrimitive)?.contentOrNull ?: if (systemDark) "dark" else "light"
                Palettes.byName(pick)
            }
            else -> Palettes.byName(name)
        }
        return base
    }
}
