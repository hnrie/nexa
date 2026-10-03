package fish.nexa

import android.app.Application
import fish.nexa.data.Auth
import fish.nexa.data.ChannelsStore
import fish.nexa.data.ExpressionsStore
import fish.nexa.data.KeyAlerts
import fish.nexa.data.KeyManager
import fish.nexa.data.KeyPins
import fish.nexa.data.MessagesStore
import fish.nexa.data.MiscStore
import fish.nexa.data.PresenceStore
import fish.nexa.data.ReadStatesStore
import fish.nexa.data.RelationshipsStore
import fish.nexa.data.SecureStore
import fish.nexa.data.ServersStore
import fish.nexa.data.Session
import fish.nexa.data.SettingsStore
import fish.nexa.data.TypingStore
import fish.nexa.data.UiState
import fish.nexa.data.UsersStore
import fish.nexa.data.VoiceStatesStore
import fish.nexa.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The app's object graph: one of each store, the network, the session. The
 * web client keeps the same things in module-level zustand stores; one
 * process-wide graph is the native equivalent, and lets the background
 * service and the UI share one live connection.
 */
object Nexa {
    lateinit var app: Application
        private set
    lateinit var api: Api
        private set
    lateinit var secure: SecureStore
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val users = UsersStore()
    val channels = ChannelsStore()
    val servers = ServersStore(users, channels)
    val relationships = RelationshipsStore(users)
    val readStates = ReadStatesStore(channels)
    val presence = PresenceStore()
    val typing = TypingStore()
    val voiceStates = VoiceStatesStore()
    val expressions = ExpressionsStore()
    val misc = MiscStore()
    val ui = UiState()

    lateinit var pins: KeyPins
        private set
    lateinit var alerts: KeyAlerts
        private set
    lateinit var keys: KeyManager
        private set
    lateinit var messages: MessagesStore
        private set
    lateinit var settings: SettingsStore
        private set
    lateinit var session: Session
        private set
    lateinit var auth: Auth
        private set

    private var started = false

    fun init(application: Application) {
        if (started) return
        started = true
        app = application
        secure = SecureStore(application)
        val server = secure.getString("server")?.takeIf { it.startsWith("http") } ?: BuildConfig.DEFAULT_SERVER
        api = Api(server.trimEnd('/'))
        pins = KeyPins(secure)
        alerts = KeyAlerts(pins)
        keys = KeyManager(api, secure, users, channels, servers, pins, alerts, scope)
        messages = MessagesStore(api, keys)
        settings = SettingsStore(api, scope)
        session = Session(this)
        auth = Auth(this)
    }
}
