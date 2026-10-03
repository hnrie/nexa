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
        open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    /** A notification or a link opened the app at a place: go there once signed in. */
    private fun open(intent: Intent?) {
        val path = intent?.getStringExtra(fish.nexa.notify.Notifier.EXTRA_PATH)
            ?: intent?.data?.takeIf { it.scheme == "https" || it.scheme == "nexa" }?.let { (it.path ?: "") }
            ?: return
        lifecycleScope.launch {
            Nexa.auth.state.first { it is fish.nexa.data.AuthState.Ready }
            fish.nexa.ui.nav.Nav.openPath(path)
        }
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
