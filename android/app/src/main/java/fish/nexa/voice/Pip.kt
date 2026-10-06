package fish.nexa.voice

import android.app.Activity
import android.app.Application
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.voice.PipStage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.lang.ref.WeakReference

/**
 * Picture in picture for a call: leaving the app while looking at a call
 * (Home, or the swipe up) keeps the call's stage in a small window over
 * everything else, and its tiles' Picture in Picture button floats it on
 * demand. While it floats the stage covers the app's own page.
 */
object Pip {
    private const val TAG = "Pip"
    private const val KEY = "call-pip"
    private val main = Handler(Looper.getMainLooper())
    private var activity: WeakReference<ComponentActivity>? = null

    private val _active = MutableStateFlow(false)
    /** The app is floating as a picture in picture. */
    val active: StateFlow<Boolean> = _active

    /** A call's stage is on screen; leaving the app then floats it. Set by the call view while it is shown. */
    @Volatile var callOnScreen = false
        set(v) {
            field = v
            update()
        }

    /**
     * Android's own screens for an update (allowing installs, the installer's
     * question) open over the app, and a call floating over them would sit on
     * their buttons, which Android then will not let anyone press. While this
     * is set (AppUpdate.install, until the app is back in front) a call does
     * not float by itself.
     */
    @Volatile var held = false
        set(v) {
            field = v
            update()
        }

    private val listener = Consumer<PictureInPictureModeChangedInfo> { info -> changed(info.isInPictureInPictureMode) }

    fun install(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(a: Activity, b: Bundle?) {
                if (a.javaClass.name != "fish.nexa.MainActivity" || a !is ComponentActivity) return
                activity = WeakReference(a)
                a.addOnPictureInPictureModeChangedListener(listener)
                update()
            }

            override fun onActivityDestroyed(a: Activity) {
                if (activity?.get() === a) {
                    (a as? ComponentActivity)?.removeOnPictureInPictureModeChangedListener(listener)
                    activity = null
                }
            }

            override fun onActivityStarted(a: Activity) = Unit
            override fun onActivityResumed(a: Activity) = Unit
            override fun onActivityPaused(a: Activity) = Unit
            override fun onActivityStopped(a: Activity) = Unit
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) = Unit
        })
    }

    private fun supported(a: Activity): Boolean = a.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun params(auto: Boolean): PictureInPictureParams {
        val st = Voice.state.value
        val video = st.localVideo != null || st.remoteVideo.isNotEmpty() || st.remoteScreen.isNotEmpty() || st.localScreen != null
        val b = PictureInPictureParams.Builder().setAspectRatio(if (video) Rational(16, 9) else Rational(1, 1))
        if (Build.VERSION.SDK_INT >= 31) {
            b.setAutoEnterEnabled(auto)
            b.setSeamlessResizeEnabled(true)
        }
        return b.build()
    }

    /**
     * Keeps the window's floating rules in step with the call: it floats by
     * itself only while a call is on screen. On the main thread it takes
     * effect at once, so a screen opened right after cannot float the call.
     */
    fun update() {
        val apply = {
            activity?.get()?.takeIf { supported(it) }?.let { a ->
                val auto = Engine.current() != null && callOnScreen && !held
                runCatching { a.setPictureInPictureParams(params(auto)) }.onFailure { Log.w(TAG, "could not set the picture in picture", it) }
            }
            Unit
        }
        if (Looper.myLooper() == Looper.getMainLooper()) apply() else main.post(apply)
    }

    /** Floats the app now (a tile's Picture in Picture button). False where the phone cannot. */
    fun enter(): Boolean {
        val a = activity?.get() ?: return false
        if (!supported(a) || Engine.current() == null) return false
        return runCatching { a.enterPictureInPictureMode(params(auto = callOnScreen)) }.getOrDefault(false)
    }

    private fun changed(on: Boolean) {
        _active.value = on
        val open = Layers.stack.any { it.key == KEY }
        if (on && !open) Layers.open(Layer(KEY) { PipStage() })
        else if (!on && open) Layers.stack.lastOrNull { it.key == KEY }?.let { Layers.remove(it) }
    }
}
