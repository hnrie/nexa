package fish.nexa.voice

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import fish.nexa.Nexa
import fish.nexa.ui.Appearance
import fish.nexa.ui.I18n
import fish.nexa.ui.Themes
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.theme.NexaTheme
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.voice.IncomingCallCard
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Mute, hang up and decline from a notification. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ch = intent.getStringExtra("channel")
        when (intent.action) {
            ACTION_MUTE -> {
                VoiceLocal.toggleMute()
                CallService.update()
            }
            ACTION_LEAVE -> Calls.leave(true)
            ACTION_DECLINE -> if (ch != null) Calls.decline(ch)
        }
    }

    companion object {
        const val ACTION_MUTE = "fish.nexa.voice.MUTE"
        const val ACTION_LEAVE = "fish.nexa.voice.LEAVE"
        const val ACTION_DECLINE = "fish.nexa.voice.DECLINE"
    }
}

/**
 * Where a call's notifications lead: back to the call, answering it, or the
 * incoming call itself, full screen over the lock screen.
 */
class CallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val ch = intent?.getStringExtra("channel")
        when (intent?.action) {
            ACTION_ANSWER -> {
                if (ch != null) {
                    IncomingCalls.answered(ch)
                    Calls.accept(ch)
                }
                unlockThenOpen()
            }
            ACTION_INCOMING -> showIncoming(ch ?: return finish())
            else -> {
                if (ch != null) goTo(ch)
                openApp()
            }
        }
    }

    private fun goTo(channelId: String) {
        val c = Nexa.channels.get(channelId) ?: return
        val sid = c.serverId
        if (sid != null && c.type != "dm" && c.type != "group_dm") Nav.go(Route.Server(sid, channelId)) else Nav.go(Route.Dm(channelId))
    }

    private fun openApp() {
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(it)
        }
        finish()
    }

    private fun unlockThenOpen() {
        val km = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        if (km.isKeyguardLocked) {
            km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = openApp()
                override fun onDismissCancelled() = openApp()
                override fun onDismissError() = openApp()
            })
        } else openApp()
    }

    private fun showIncoming(channelId: String) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        setContent {
            val look = Appearance.remembered()
            NexaTheme(
                colors = Themes.resolve(look.theme, look.accent, androidx.compose.foundation.isSystemInDarkTheme()),
                fontScale = look.fontScale,
                classic = look.classic,
                reducedMotion = look.reducedMotion,
                rtl = I18n.rtl,
            ) {
                val ringing by Voice.ringing.collectAsState()
                val ring = ringing[channelId]
                // answered, declined or gone: nothing left to show
                LaunchedEffect(ring == null) { if (ring == null) finish() }
                Box(Modifier.fillMaxSize().background(Nx.colors.bgCanvas), contentAlignment = Alignment.Center) {
                    if (ring != null) IncomingCallCard(
                        channelId = channelId,
                        from = ring.from,
                        onDecline = { Calls.decline(channelId); finish() },
                        onIgnore = { Calls.ignore(channelId); finish() },
                        onAccept = {
                            IncomingCalls.answered(channelId)
                            Calls.accept(channelId)
                            unlockThenOpen()
                        },
                    )
                }
            }
        }
    }

    companion object {
        const val ACTION_OPEN = "fish.nexa.voice.OPEN"
        const val ACTION_ANSWER = "fish.nexa.voice.ANSWER"
        const val ACTION_INCOMING = "fish.nexa.voice.INCOMING"
    }
}

/** Runtime permissions asked for from anywhere in the app, through a window of their own. */
object Permissions {
    private val waiting = ConcurrentHashMap<Int, CompletableDeferred<Map<String, Boolean>>>()
    private val ids = AtomicInteger()

    fun granted(p: String): Boolean = ContextCompat.checkSelfPermission(Nexa.app, p) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** Asks for the permissions not yet given; answers at once for the ones that are. */
    suspend fun request(perms: Array<String>): Map<String, Boolean> {
        val missing = perms.filterNot { granted(it) }
        if (missing.isEmpty()) return perms.associateWith { true }
        val id = ids.incrementAndGet()
        val done = CompletableDeferred<Map<String, Boolean>>()
        waiting[id] = done
        val i = Intent(Nexa.app, PermissionActivity::class.java).putExtra("id", id).putExtra("perms", missing.toTypedArray()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        Nexa.app.startActivity(i)
        val got = done.await()
        return perms.associateWith { granted(it) || got[it] == true }
    }

    internal fun answer(id: Int, result: Map<String, Boolean>) {
        waiting.remove(id)?.complete(result)
    }
}

class PermissionActivity : ComponentActivity() {
    private var id = 0
    private var answered = false
    private val ask = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        answered = true
        Permissions.answer(id, result)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        id = intent.getIntExtra("id", 0)
        val perms = intent.getStringArrayExtra("perms") ?: emptyArray()
        if (savedInstanceState == null) ask.launch(perms)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (!answered && isFinishing) Permissions.answer(id, emptyMap())
    }
}

/** The system's screen sharing consent: its answer is what a share is started with. */
object ScreenConsent {
    @Volatile private var waiting: CompletableDeferred<Intent?>? = null

    suspend fun ask(): Intent? {
        val done = CompletableDeferred<Intent?>()
        waiting = done
        Nexa.app.startActivity(Intent(Nexa.app, ScreenCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return done.await()
    }

    internal fun answer(data: Intent?) {
        waiting?.complete(data)
        waiting = null
    }
}

class ScreenCaptureActivity : ComponentActivity() {
    private var answered = false
    private val ask = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        answered = true
        ScreenConsent.answer(if (result.resultCode == Activity.RESULT_OK) result.data else null)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        if (savedInstanceState == null) ask.launch(mpm.createScreenCaptureIntent())
    }

    override fun onDestroy() {
        super.onDestroy()
        if (!answered && isFinishing) ScreenConsent.answer(null)
    }
}
