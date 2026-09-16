package xyz.evilion.chat.data

import kotlinx.coroutines.CompletableDeferred

/**
 * Cloudflare Turnstile, for the actions a bot would abuse: signing up, signing
 * in, recovering an account, friend requests, making and joining servers.
 *
 * Turnstile has no native SDK, and the server checks the hostname the challenge
 * was solved on, so the widget is shown in a small web view over the instance's
 * own page. It is the one piece of web in the app, and it is Cloudflare's, not
 * ours.
 */
object Captcha {
    /** Set by the activity: shows the sheet and answers with a token, or null if it was cancelled. */
    @Volatile
    var present: (suspend (action: String, siteKey: String) -> String?)? = null

    class Cancelled : Exception("The captcha was cancelled.")

    suspend fun token(action: String, siteKey: String): String? {
        val show = present ?: return null
        return show(action, siteKey) ?: throw Cancelled()
    }
}
