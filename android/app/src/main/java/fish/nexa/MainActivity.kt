package fish.nexa

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import fish.nexa.ui.App
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        if (Nexa.auth.state.value == fish.nexa.data.AuthState.Loading) lifecycleScope.launch { Nexa.auth.bootstrap() }
        setContent { App() }
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
