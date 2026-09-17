package xyz.evilion.chat.data

import android.util.Log
import xyz.evilion.chat.i18n.t

/**
 * What to show a person when something failed.
 *
 * `catch { error = it.message }` was the habit, and an exception whose message
 * is null — which is most of them, including every NullPointerException — drew
 * nothing at all. The button appeared to do nothing, and there was no way from
 * the device to find out why.
 *
 * Every failure now says something, and every failure reaches logcat, which is
 * the only thing to debug from when the app is on someone's phone.
 */
fun Throwable.readable(where: String? = null): String {
    Log.w(LOG_TAG, "failed" + (where?.let { " at $it" } ?: ""), this)
    val said = message?.trim()
    if (!said.isNullOrEmpty()) return said
    return t("errors.somethingWentWrong", "detail" to (this::class.simpleName ?: "error"))
}

const val LOG_TAG = "Nexa"
