package fish.nexa

import android.app.Application
import fish.nexa.ui.I18n
import fish.nexa.ui.Lucide
import fish.nexa.ui.auth.CaptchaHost

class NexaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Nexa.init(this)
        I18n.init(this)
        I18n.use(null)
        Lucide.init(this)
        fish.nexa.media.Media.init(this)
        fish.nexa.media.Twemoji.init(this)
        Nexa.auth.captcha = CaptchaHost
        // calls: rings, the mute buttons and the voice events, from the start
        fish.nexa.voice.Calls.install(this)
        fish.nexa.voice.Pip.install(this)
    }
}
