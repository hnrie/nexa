package xyz.evilion.chat.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import xyz.evilion.chat.BuildConfig
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Api
import java.io.File
import java.security.MessageDigest

/**
 * Keeping the app up to date, with no store in the middle.
 *
 * The app is installed from a website, so nothing tells anyone that a newer
 * build exists — and nothing here did either, although the permission
 * (`REQUEST_INSTALL_PACKAGES`), the file provider and the endpoint that serves
 * exactly what this needs have all been in place since the first release.
 * Somebody on 1.0.2 would simply never have heard about 1.0.3.
 *
 * Three things matter and are easy to get wrong:
 *
 * **The right build.** Releases are published four times over: one that runs
 * anywhere, at about 39 MB, and three carrying code for a single processor, the
 * largest of which is 16 MB. A phone knows exactly which of those it can run
 * ([Build.SUPPORTED_ABIS], most preferred first), so taking the universal one
 * costs every phone more than twice what the update is worth.
 *
 * **The right file.** The download comes from the same host as the manifest
 * that describes it, so its SHA-256 is not a signature and proves nothing about
 * who made it — Android's own signature check does that, and refuses an APK not
 * signed with the key the installed app carries. What the hash does catch is a
 * truncated or corrupted download, which is the failure this will actually meet,
 * and it is worth catching before the installer is asked to do something with it.
 *
 * **Permission to install.** Android asks the person once, per app, for the
 * right to install anything at all, and refuses silently if they have not been
 * asked. So it is asked for at the point it is needed, with the reason on
 * screen, rather than sprung at the end of a download.
 */
object AppUpdate {

    @Serializable
    data class Variant(
        val abi: String = "",
        val name: String = "",
        val size: Long = 0,
        val sha256: String = "",
    )

    @Serializable
    data class Release(
        val version: String = "",
        val versionCode: Int = 0,
        val releasedAt: Long = 0,
        val name: String = "",
        val size: Long = 0,
        val sha256: String = "",
        val minSdk: Int = 0,
        val files: List<Variant> = emptyList(),
        val notes: String? = null,
    )

    /** What is being done about an update, for the screen that shows it. */
    sealed interface State {
        data object Idle : State
        data object Checking : State
        /** Nothing newer than what is running. */
        data object UpToDate : State
        data class Available(val release: Release, val build: Variant) : State
        data class Downloading(val release: Release, val build: Variant, val done: Long) : State
        data class Ready(val release: Release, val file: File) : State
        data class Failed(val why: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    /**
     * The newest release, or null when this instance publishes none.
     *
     * The path is spelled out in full because `/android/` is one of the
     * prefixes [Api.url] passes through verbatim — that is the route the APK
     * files themselves are served from, and a bare "/android/latest" would ask
     * for a file by that name rather than for the manifest.
     */
    suspend fun latest(): Release? = runCatching { Api.request<Release>("GET", "/api/v1/android/latest") }.getOrNull()

    /**
     * The build this phone should take: the first of its supported processors
     * that the release carries, or the one that runs anywhere.
     *
     * SUPPORTED_ABIS is in order of preference, so a 64-bit phone that can also
     * run 32-bit code is offered the 64-bit build first, which is what it
     * should have. It is a parameter so that a test can be a test: the real
     * one is null on a plain JVM.
     */
    fun variantFor(release: Release, abis: Array<String> = android.os.Build.SUPPORTED_ABIS): Variant {
        for (abi in abis) {
            release.files.firstOrNull { it.abi == abi }?.let { return it }
        }
        return release.files.firstOrNull { it.abi == "universal" }
            ?: Variant(abi = "universal", name = release.name, size = release.size, sha256 = release.sha256)
    }

    /** Whether `release` is newer than what is running. */
    fun isNewer(release: Release): Boolean = release.versionCode > BuildConfig.VERSION_CODE

    /**
     * Asks the server what the newest release is and remembers the answer.
     *
     * Quiet by design: a check that fails — no network, an instance that
     * publishes no Android build — leaves the state alone rather than putting
     * an error in front of somebody who did not ask for one. [check] with
     * `loud` is the button in settings, which does want to say what happened.
     */
    suspend fun check(loud: Boolean = false) {
        if (_state.value is State.Downloading) return
        if (loud) _state.value = State.Checking
        val release = latest()
        if (release == null || release.name.isEmpty()) {
            if (loud) _state.value = State.Failed(t("appUpdate.couldNotAskThisServerForUpdates"))
            return
        }
        // A build for an Android older than this phone would not install.
        if (!isNewer(release) || release.minSdk > android.os.Build.VERSION.SDK_INT) {
            if (loud) _state.value = State.UpToDate
            return
        }
        _state.value = State.Available(release, variantFor(release))
    }

    /** Whether the person has allowed this app to install anything. */
    fun mayInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Opens the one system screen where that is granted. */
    fun askToInstall(context: Context) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    /**
     * Fetches the build and checks it arrived whole.
     *
     * The file is written beside the cache under a name of its own version, so
     * a download interrupted halfway is replaced rather than resumed into: a
     * half file that matched nothing would be indistinguishable from a
     * corrupted one, and this is small enough that starting again is cheaper
     * than being clever.
     */
    suspend fun download(context: Context, release: Release, build: Variant) {
        _state.value = State.Downloading(release, build, 0)
        val result = runCatching {
            withContext(Dispatchers.IO) {
                val dir = File(context.cacheDir, "updates").apply { mkdirs() }
                // nothing but this release's file survives here
                dir.listFiles()?.forEach { if (it.name != build.name) it.delete() }
                val target = File(dir, build.name)
                val digest = MessageDigest.getInstance("SHA-256")
                Api.openStream("/android/${Uri.encode(build.name)}", authorized = false).use { stream ->
                    target.outputStream().use { out ->
                        val buffer = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            val read = stream.input.read(buffer)
                            if (read <= 0) break
                            out.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            done += read
                            _state.value = State.Downloading(release, build, done)
                        }
                    }
                }
                val got = digest.digest().joinToString("") { "%02x".format(it) }
                if (build.sha256.isNotEmpty() && !got.equals(build.sha256, ignoreCase = true)) {
                    target.delete()
                    error(t("appUpdate.theDownloadCameOutDifferentFrom"))
                }
                target
            }
        }
        _state.value = result.fold(
            onSuccess = { State.Ready(release, it) },
            onFailure = { State.Failed(it.readable("AppUpdate")) },
        )
    }

    /**
     * Hands the file to the system installer.
     *
     * Android verifies the signature itself and refuses an APK not signed with
     * the key the installed app carries, which is the check that actually
     * matters — a different key cannot update this app, by design, and that is
     * why the signing key is worth keeping safe.
     */
    fun install(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onFailure { _state.value = State.Failed(it.readable("AppUpdate.install")) }
    }

    fun dismiss() {
        _state.value = State.Idle
    }
}
