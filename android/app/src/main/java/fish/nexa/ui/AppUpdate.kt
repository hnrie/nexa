package fish.nexa.ui

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import fish.nexa.BuildConfig
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.net.wireJson
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.openDialog
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.brandGradient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * The app's own updates (the web's UpdateDialog, for the APK people install
 * from the download page): the server publishes the newest build at
 * /api/v1/android/latest, and when it is newer than this copy the app offers
 * it. Update downloads the build for this phone's processor, checks it
 * against the published fingerprint, and opens Android's installer, which
 * replaces this copy with it.
 */
object AppUpdate {
    /** One published build: for one processor, or "universal" for any. */
    @Serializable
    data class Apk(val abi: String, val name: String, val size: Long = 0, val sha256: String)

    @Serializable
    data class Release(
        val version: String = "",
        @SerialName("version_code") val versionCode: Int = 0,
        val files: List<Apk> = emptyList(),
        val notes: String? = null,
    )

    /** How often the app asks again while it stays open. */
    private const val EVERY = 6 * 60 * 60 * 1000L
    private var askedAt = 0L
    /** A version put off with Later is not offered again until the app starts anew. */
    private var putOff = 0

    /** Asks the server for the newest build and offers it when it is newer; quietly does nothing otherwise. */
    fun check() {
        // a debug build is its own app (fish.nexa.debug) and is never replaced by a release
        if (BuildConfig.DEBUG) return
        val now = System.currentTimeMillis()
        if (now - askedAt < EVERY) return
        askedAt = now
        Nexa.scope.launch {
            val rel = runCatching { wireJson.decodeFromJsonElement(Release.serializer(), Nexa.api.get("/android/latest")) }.getOrNull() ?: return@launch
            if (rel.versionCode <= BuildConfig.VERSION_CODE || rel.versionCode == putOff || pick(rel) == null) return@launch
            // offered once the Terms are agreed and nothing else is open over the app, checked where layers open so nothing slips in between
            withContext(Dispatchers.Main) {
                while (!Layers.isEmpty || Nexa.users.me.value?.let { fish.nexa.ui.legal.Legal.accepted(it.id) } != true) delay(1000)
                offer(rel)
            }
        }
    }

    /** The build for this phone: its processor's own, else the one that installs anywhere. */
    private fun pick(rel: Release): Apk? {
        for (abi in Build.SUPPORTED_ABIS) rel.files.firstOrNull { it.abi == abi }?.let { return it }
        return rel.files.firstOrNull { it.abi == "universal" }
    }

    private fun offer(rel: Release) {
        var progress by mutableStateOf<Float?>(null)
        var failed by mutableStateOf<String?>(null)
        // what to do on Android's own screen; guidance, not an error
        var hint by mutableStateOf(false)
        val got = mutableFloatStateOf(0f)
        openDialog(
            "app-update",
            t("shell.update.title"),
            width = 440.dp,
            onClosed = { if (progress == null) putOff = rel.versionCode },
            footer = { close ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
                    NxButton(t("shell.update.later"), close, kind = ButtonKind.GHOST)
                    NxButton(t("shell.update.update"), {
                        val file = pick(rel) ?: return@NxButton
                        if (!canInstall()) {
                            // Android asks once whether Nexa may install apps; the person comes back and presses Update again
                            failed = null
                            hint = true
                            runCatching {
                                Nexa.app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + Nexa.app.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }
                            return@NxButton
                        }
                        failed = null
                        hint = false
                        progress = 0f
                        Nexa.scope.launch {
                            val apk = runCatching { download(file) { got.floatValue = it } }.getOrNull()
                            if (apk == null) {
                                progress = null
                                failed = t("android.update.failed")
                                return@launch
                            }
                            withContext(Dispatchers.Main) {
                                install(apk)
                                close()
                            }
                        }
                    }, loading = progress != null)
                }
            },
        ) {
            val c = Nx.colors
            // back from Android's screen with installs allowed, the hint has done its job
            val visible by Nexa.ui.visible.collectAsState()
            LaunchedEffect(visible) { if (visible && hint && canInstall()) hint = false }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Txt(t("android.update.body"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(22.5f)), color = c.textSubtle)
                Txt(t("shell.update.version", "version" to rel.version), style = Nx.type.bodySmall, color = c.textMuted)
                rel.notes?.takeIf { it.isNotBlank() }?.let { Txt(it, style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(20f)), color = c.text) }
                if (progress != null) {
                    val v = got.floatValue
                    Box(
                        Modifier
                            .padding(top = 4.dp)
                            .fillMaxWidth()
                            .height(6.dp)
                            .background(c.bgInput, RoundedCornerShape(3.dp))
                            .semantics {
                                contentDescription = t("shell.update.progress")
                                progressBarRangeInfo = ProgressBarRangeInfo(v, 0f..1f)
                            },
                    ) { Box(Modifier.fillMaxWidth(maxOf(0.04f, v)).height(6.dp).background(brandGradient(c), RoundedCornerShape(3.dp))) }
                }
                if (hint) Txt(t("android.update.allowInstalls"), style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(20f)), color = c.text)
                failed?.let { Txt(it, style = Nx.type.bodySmall, color = c.textDanger) }
            }
        }
    }

    /** Whether Android lets Nexa hand a build to its installer (asked once, on Android's own screen). */
    private fun canInstall(): Boolean = Build.VERSION.SDK_INT < 26 || Nexa.app.packageManager.canRequestPackageInstalls()

    /** Downloads a build into the cache, checked against its published fingerprint; null when it does not match. */
    private suspend fun download(file: Apk, onProgress: (Float) -> Unit): File? = withContext(Dispatchers.IO) {
        val dir = File(Nexa.app.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "nexa-${file.sha256.take(12)}.apk")
        val url = Nexa.api.baseUrl + "/android/" + java.net.URLEncoder.encode(file.name, "UTF-8").replace("+", "%20") + "?v=" + file.sha256.take(12)
        val req = okhttp3.Request.Builder().url(url).header("User-Agent", Nexa.api.userAgent).get().build()
        val digest = MessageDigest.getInstance("SHA-256")
        Nexa.api.await(Nexa.api.transfer.newCall(req)).use { res ->
            if (!res.isSuccessful) return@withContext null
            val body = res.body ?: return@withContext null
            val total = body.contentLength().takeIf { it > 0 } ?: file.size
            var done = 0L
            body.byteStream().use { input ->
                out.outputStream().use { sink ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        sink.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        done += n
                        if (total > 0) onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                    }
                }
            }
        }
        if (!Bytes.hex(digest.digest()).equals(file.sha256, ignoreCase = true)) {
            out.delete()
            return@withContext null
        }
        out
    }

    /** Hands the build to Android's installer, which asks before replacing this copy. */
    private fun install(apk: File) {
        val uri = FileProvider.getUriForFile(Nexa.app, Nexa.app.packageName + ".files", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { Nexa.app.startActivity(intent) }
    }
}
