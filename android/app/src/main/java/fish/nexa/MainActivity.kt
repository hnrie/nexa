package fish.nexa

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import fish.nexa.ui.App
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        lifecycleScope.launch { Nexa.auth.bootstrap() }
        setContent { App() }
        if (!open(intent)) lifecycleScope.launch {
            Nexa.auth.state.first { it is fish.nexa.data.AuthState.Ready }
            fish.nexa.ui.nav.Nav.restore()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        open(intent)
    }

    /** A notification, a link or a share opened the app: act on it once signed in. False when it said nothing. */
    private fun open(intent: Intent?): Boolean {
        // debug builds only: open a screen directly for checking it (adb shell am start ... --es debug.open whatsnew)
        if (BuildConfig.DEBUG && intent?.getStringExtra("debug.open") == "whatsnew") {
            lifecycleScope.launch {
                Nexa.auth.state.first { it is fish.nexa.data.AuthState.Ready }
                fish.nexa.ui.WhatsNew.openAll()
            }
            return true
        }
        fish.nexa.ui.share.Share.from(intent)?.let { incoming ->
            val direct = fish.nexa.ui.share.Share.channelOf(intent)
            lifecycleScope.launch {
                Nexa.auth.state.first { it is fish.nexa.data.AuthState.Ready }
                if (direct != null && Nexa.channels.get(direct) != null) fish.nexa.ui.share.Share.deliver(incoming, direct)
                else fish.nexa.ui.share.Share.openPicker(incoming)
            }
            return true
        }
        val path = intent?.getStringExtra(fish.nexa.notify.Notifier.EXTRA_PATH)
            ?: intent?.data?.takeIf { it.scheme == "https" }?.path
            ?: return false
        lifecycleScope.launch {
            Nexa.auth.state.first { it is fish.nexa.data.AuthState.Ready }
            fish.nexa.ui.nav.Nav.openPath(path)
        }
        return true
    }

    override fun onStart() {
        super.onStart()
        Nexa.ui.setVisible(true)
        Nexa.session.wake()
    }

    override fun onStop() {
        super.onStop()
        Nexa.ui.setVisible(false)
    }
}
