package fish.nexa.ui.auth

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import fish.nexa.Nexa
import fish.nexa.data.CaptchaProvider
import fish.nexa.net.ApiError
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.panel
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject

/**
 * Cloudflare Turnstile, in the one web view this app has. The server checks
 * the hostname a token was solved on, so the widget runs in a page whose
 * address is the instance's own (loadDataWithBaseURL); the token comes back
 * through a bridge and goes on the one request it was made for. Like the web,
 * the sheet only shows when Turnstile wants a click.
 */
object CaptchaHost : CaptchaProvider {
    private class Request(val siteKey: String, val action: String, val result: CompletableDeferred<String>)

    private var current by mutableStateOf<Request?>(null)
    private var shown by mutableStateOf(false)

    override suspend fun token(siteKey: String, action: String): String {
        val r = Request(siteKey, action, CompletableDeferred())
        current = r
        shown = false
        try {
            return r.result.await()
        } finally {
            if (current === r) current = null
        }
    }

    private fun page(siteKey: String, action: String, dark: Boolean, bg: Int): String {
        val color = String.format("#%06x", bg and 0xFFFFFF)
        return """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:$color;display:flex;align-items:center;justify-content:center;min-height:100%}</style></head>
<body><div id="slot"></div>
<script>
function done(t){NexaCaptcha.onToken(t)}
function fail(c){NexaCaptcha.onError(c||"failed")}
window.onload=function(){
  var tries=0;(function wait(){
    if(window.turnstile){turnstile.render("#slot",{sitekey:${JSONObject.quote(siteKey)},action:${JSONObject.quote(action)},theme:"${if (dark) "dark" else "light"}",appearance:"interaction-only",
      callback:done,"error-callback":function(){fail("failed")},"timeout-callback":function(){fail("timeout")},
      "before-interactive-callback":function(){NexaCaptcha.onShow()},"after-interactive-callback":function(){NexaCaptcha.onHide()}});return}
    if(++tries>150)return fail("unavailable");setTimeout(wait,100)})()}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onerror="fail('unavailable')"></script>
</body></html>"""
    }

    /** Drawn once at the root of the app; invisible until a request needs a click. */
    @SuppressLint("SetJavaScriptEnabled")
    @Composable
    fun Sheet() {
        val r = current ?: return
        val c = Nx.colors
        Box(
            Modifier
                .fillMaxSize()
                .then(if (shown) Modifier.background(c.bgOverlay) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier
                    .padding(16.dp)
                    .widthIn(max = 360.dp)
                    .then(if (shown) Modifier.panel(Radii.Lg, c, c.bgFloating, high = true).padding(20.dp) else Modifier.height(1.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (shown) Txt(t("captcha.oneQuickCheck"), style = Nx.type.sheetTitle, color = c.textStrong)
                AndroidView(
                    modifier = Modifier.fillMaxWidth().height(if (shown) 80.dp else 1.dp),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            setBackgroundColor(c.bgFloating.toArgb())
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.cacheMode = WebSettings.LOAD_DEFAULT
                            webChromeClient = WebChromeClient()
                            webViewClient = WebViewClient()
                            addJavascriptInterface(object {
                                @JavascriptInterface fun onToken(token: String) = r.result.complete(token).let { }
                                @JavascriptInterface fun onError(code: String) {
                                    val err = if (code == "unavailable") ApiError(0, "captcha_unavailable", t("captcha.theCaptchaCouldNotLoadCheck"))
                                    else ApiError(0, "captcha_failed", t("captcha.theCaptchaCheckFailedPleaseTry"))
                                    r.result.completeExceptionally(err)
                                }
                                @JavascriptInterface fun onShow() = post { shown = true }.let { }
                                @JavascriptInterface fun onHide() = post { shown = false }.let { }
                            }, "NexaCaptcha")
                            loadDataWithBaseURL(Nexa.api.baseUrl + "/", page(r.siteKey, r.action, !c.isLight, c.bgFloating.toArgb()), "text/html", "utf-8", null)
                        }
                    },
                )
                if (shown) NxButton(t("chat.editMessage.cancel"), onClick = {
                    r.result.completeExceptionally(ApiError(0, "captcha_cancelled", t("captcha.theCaptchaWasCancelled")))
                }, kind = ButtonKind.GHOST)
            }
        }
    }
}
