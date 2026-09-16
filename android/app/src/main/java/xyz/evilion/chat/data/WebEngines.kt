package xyz.evilion.chat.data

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.webkit.WebViewCompat

/**
 * Which engine should run the captcha.
 *
 * The one thing on a phone this app cannot bring with it is a browser engine:
 * the system web view belongs to the system, and on a phone that stopped
 * getting updates it can be years old — old enough that Cloudflare's check
 * never finishes and there is no way past the sign-in screen. So the app looks
 * at what the phone has and picks: its own sheet when the web view is current,
 * and the browser the person actually uses when it is not, since browsers keep
 * updating themselves long after a phone's system parts stop.
 */
object WebEngines {
    /** Below this the system web view is treated as too old to be trusted with a challenge. */
    private const val FLOOR = 100

    data class Engine(val name: String, val major: Int, val version: String)

    /** The system web view, if there is one and it is enabled. */
    fun webView(context: Context): Engine? {
        val pkg = runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull() ?: return null
        val enabled = runCatching {
            context.packageManager.getApplicationInfo(pkg.packageName, 0).enabled
        }.getOrDefault(true)
        if (!enabled) return null
        val version = pkg.versionName ?: return Engine(pkg.packageName, 0, "unknown")
        return Engine(pkg.packageName, major(version), version)
    }

    /** Whatever opens https links, if anything does. */
    fun browser(context: Context): Engine? {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://evilion.xyz/")).addCategory(Intent.CATEGORY_BROWSABLE)
        val resolved = runCatching {
            context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }.getOrNull() ?: return null
        val name = resolved.activityInfo?.packageName ?: return null
        if (name == "android" || name.contains("resolver")) {
            // no default browser: whichever is installed will still take the link
            val any = runCatching {
                context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            }.getOrNull()?.firstOrNull()?.activityInfo?.packageName ?: return null
            return engineFor(context, any)
        }
        return engineFor(context, name)
    }

    private fun engineFor(context: Context, packageName: String): Engine {
        val version = runCatching {
            context.packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull() ?: return Engine(packageName, 0, "unknown")
        return Engine(packageName, major(version), version)
    }

    private fun major(version: String): Int = version.substringBefore('.').toIntOrNull() ?: 0

    /** True when the captcha should go to the phone's browser rather than the app's own sheet. */
    fun preferBrowser(context: Context): Boolean {
        val web = webView(context)
        if (web == null) return true
        if (web.major >= FLOOR) return false
        val browser = browser(context) ?: return false // nothing better to hand it to
        return browser.major > web.major
    }

    /** What to tell someone whose phone cannot run the check anywhere. */
    fun describe(context: Context): String {
        val web = webView(context)
        val browser = browser(context)
        return buildString {
            append(web?.let { "web view ${it.version}" } ?: "no web view")
            append(" · ")
            append(browser?.let { "browser ${it.name} ${it.version}" } ?: "no browser")
        }
    }
}
