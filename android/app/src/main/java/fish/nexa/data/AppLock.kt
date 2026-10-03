package fish.nexa.data

import android.content.Context
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Identity
import fish.nexa.crypto.Kdf
import fish.nexa.crypto.KdfParams
import fish.nexa.crypto.Keys
import fish.nexa.ui.ReadableError
import fish.nexa.ui.t
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** When the app locks by itself: idle time, and leaving the app (after a delay). */
data class LockTimings(val autoLockMs: Long = 300_000, val lockOnBlur: Boolean = false, val blurDelayMs: Long = 0)

/**
 * This device's lock record (lib/appLock.ts LockConfig): the identity private
 * key wrapped with a key stretched from the passcode, and the wrong tries it
 * has seen. Kept sealed on this device and never synced.
 */
data class LockConfig(
    val salt: String,
    val params: KdfParams,
    val wrapped: String,
    val pub: String,
    val timings: LockTimings,
    val failures: Int,
    /** All digits, so the lock screen offers the number keyboard; unknown on records from before it was kept. */
    val numeric: Boolean?,
)

/** The account's passcode (settings.appLock): enough for another device to check one, nothing to unlock with. */
data class LockPolicy(val salt: String, val params: KdfParams, val verifier: String, val timings: LockTimings)

/** A wrong passcode; [left] is the tries before this device forgets its keys, null where nothing is counted. */
class WrongPasscode(val left: Int?) : Exception(
    when {
        left == null -> t("appLock.wrongPasscode")
        left > 0 -> t("appLock.wrongPasscodeTriesLeft", "count" to left)
        else -> t("appLock.tooManyWrongPasscodes")
    },
)

/**
 * The passcode (lib/appLock.ts), byte for byte as the web makes it, so a
 * passcode set on one device opens the account's lock on any other.
 *
 * Turning it on wraps the identity with a key stretched from the passcode and
 * deletes the plain copy, so locking only has to forget what is in memory.
 * Ten wrong tries throw the wrapped copy away; the password always gets the
 * owner back in.
 */
object AppLock {
    /** Heavier than the login's: a passcode of digits needs the help. */
    val LOCK_KDF = KdfParams(m = 65536, t = 6, p = 1, v = 1)
    const val MAX_FAILURES = 10
    private const val MIN_PASSCODE = 4
    private const val MIN_NUMERIC_PASSCODE = 6
    private val INFO_VERIFY = Bytes.utf8("evilion-chat/app-lock-verify/v1")

    /**
     * Set by the call engine: whether this device is in a call (or joining
     * one), and leaving it. A lock keeps a call going.
     */
    @Volatile var inCall: () -> Boolean = { false }
    @Volatile var leaveCall: () -> Unit = {}

    private fun name(userId: String) = "lock-$userId"
    private var cached: Pair<String, LockConfig?>? = null

    @Synchronized fun load(userId: String): LockConfig? {
        cached?.let { if (it.first == userId) return it.second }
        val cfg = Nexa.secure.getString(name(userId))?.let { parse(it) }
        cached = userId to cfg
        return cfg
    }

    @Synchronized fun save(userId: String, cfg: LockConfig) {
        Nexa.secure.putString(name(userId), encode(cfg).toString())
        cached = userId to cfg
    }

    /** Forgets this device's passcode, and the fingerprint copy with it unless told to keep that. */
    @Synchronized fun clear(userId: String, biometric: Boolean = true) {
        Nexa.secure.delete(name(userId))
        cached = userId to null
        if (biometric) BiometricLock.forget(userId)
    }

    fun has(userId: String?): Boolean = userId != null && load(userId) != null

    /** New timings for this device's record; the wrapped key stays as it is. */
    fun patch(userId: String, timings: LockTimings): LockConfig? {
        val cfg = load(userId) ?: return null
        return cfg.copy(timings = timings).also { save(userId, it) }
    }

    fun triesLeft(userId: String): Int = load(userId)?.let { maxOf(0, MAX_FAILURES - it.failures) } ?: MAX_FAILURES

    /** True for a passcode a number keyboard can type (/^\d+$/). */
    fun isNumeric(passcode: String): Boolean = passcode.isNotEmpty() && passcode.all { it in '0'..'9' }

    /** Why a new passcode will not do, or null when it is fine. Old ones keep working whatever they are. */
    fun problem(passcode: String): String? = when {
        isNumeric(passcode) && passcode.length < MIN_NUMERIC_PASSCODE -> t("appLock.useAtLeastDigits", "count" to MIN_NUMERIC_PASSCODE)
        passcode.length < MIN_PASSCODE -> t("appLock.useAtLeastCharacters", "count" to MIN_PASSCODE)
        passcode.length > 128 -> t("appLock.thatIsTooLong")
        oneRepeated(passcode) -> t("appLock.pickSomethingLessGuessableThanOne")
        else -> null
    }

    // /^(.)\1*$/ as JavaScript reads it: one UTF-16 unit that is not a line break, repeated
    private fun oneRepeated(p: String): Boolean = p.isNotEmpty() && p[0] !in "\n\r  " && p.all { it == p[0] }

    /** argon2id, then HKDF "evilion-chat/enc/v1": the same as the password's encryption key. Slow: off the main thread. */
    private fun passcodeKey(passcode: String, salt: ByteArray, params: KdfParams): ByteArray {
        val master = Kdf.deriveMaster(passcode, salt, params)
        return Kdf.encKey(master).also { master.fill(0) }
    }

    private fun verifierOf(key: ByteArray): String = Bytes.b64(Bytes.hkdf(key, ByteArray(0), INFO_VERIFY, 32))

    /** Turns the lock on here: writes the record, and returns the policy for the account. */
    fun enable(userId: String, identity: Identity, passcode: String, timings: LockTimings): LockPolicy {
        problem(passcode)?.let { throw ReadableError(it) }
        val salt = Bytes.random(16)
        val key = passcodeKey(passcode, salt, LOCK_KDF)
        val cfg = LockConfig(
            salt = Bytes.b64(salt),
            params = LOCK_KDF,
            wrapped = Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, key)),
            pub = Bytes.b64(identity.publicKey),
            timings = timings,
            failures = 0,
            numeric = isNumeric(passcode),
        )
        // the verifier comes from the same key the web derives a second time for it
        val policy = LockPolicy(cfg.salt, cfg.params, verifierOf(key), timings)
        key.fill(0)
        save(userId, cfg)
        return policy
    }

    /**
     * A device new to the account's passcode: checks it against the policy,
     * then wraps this device's identity with it. A mismatch is not counted:
     * there is no wrapped key here yet to throw away.
     */
    fun adopt(userId: String, identity: Identity, passcode: String, policy: LockPolicy): LockConfig {
        val key = passcodeKey(passcode, Bytes.unb64(policy.salt), policy.params)
        if (verifierOf(key) != policy.verifier) throw WrongPasscode(null)
        val cfg = LockConfig(
            salt = policy.salt,
            params = policy.params,
            wrapped = Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, key)),
            pub = Bytes.b64(identity.publicKey),
            timings = policy.timings,
            failures = 0,
            numeric = isNumeric(passcode),
        )
        key.fill(0)
        save(userId, cfg)
        return cfg
    }

    /** The identity back from the passcode. Each wrong one counts; the tenth deletes the wrapped key. */
    fun unlock(userId: String, passcode: String): Identity {
        val cfg = load(userId) ?: throw ReadableError(t("appLock.thisDeviceHasNoPasscode"))
        val key = passcodeKey(passcode, Bytes.unb64(cfg.salt), cfg.params)
        val priv = try {
            Keys.unwrapPrivateKey(Bytes.unb64(cfg.wrapped), key)
        } catch (_: Exception) {
            null
        } finally {
            key.fill(0)
        }
        if (priv == null) {
            val failures = cfg.failures + 1
            val left = MAX_FAILURES - failures
            if (left <= 0) clear(userId) else save(userId, cfg.copy(failures = failures))
            throw WrongPasscode(maxOf(0, left))
        }
        succeeded(userId, isNumeric(passcode))
        return Identity(Bytes.unb64(cfg.pub), priv)
    }

    /** An unlock went through: the count starts again (and the number keyboard is remembered). */
    fun succeeded(userId: String, numeric: Boolean? = null) {
        val cfg = load(userId) ?: return
        val n = numeric ?: cfg.numeric
        if (cfg.failures != 0 || cfg.numeric != n) save(userId, cfg.copy(failures = 0, numeric = n))
    }

    // ---- the synced policy ----

    /** The account's passcode as settings.appLock holds it; null when there is none (or it cannot be read). */
    fun policyOf(doc: JsonObject): LockPolicy? {
        val o = doc["appLock"] as? JsonObject ?: return null
        val salt = o.str("salt") ?: return null
        val verifier = o.str("verifier") ?: return null
        val params = paramsOf(o["params"]) ?: return null
        return LockPolicy(salt, params, verifier, timingsOf(o))
    }

    /** Whether the account has a passcode at all: anything but null counts, so one this app cannot read is never dropped. */
    fun policySet(doc: JsonObject): Boolean = doc["appLock"] is JsonObject

    fun policyJson(p: LockPolicy): JsonObject = buildJsonObject {
        put("salt", p.salt)
        put("params", paramsJson(p.params))
        put("verifier", p.verifier)
        put("autoLockMs", p.timings.autoLockMs)
        put("lockOnBlur", p.timings.lockOnBlur)
        put("blurDelayMs", p.timings.blurDelayMs)
    }

    /** `{...policy, ...timings}`: the timings changed, everything else in the policy kept as it is. */
    fun policyWithTimings(policy: JsonObject, t: LockTimings): JsonObject = JsonObject(
        LinkedHashMap(policy).apply {
            put("autoLockMs", JsonPrimitive(t.autoLockMs))
            put("lockOnBlur", JsonPrimitive(t.lockOnBlur))
            put("blurDelayMs", JsonPrimitive(t.blurDelayMs))
        },
    )

    // ---- the record as JSON, in the web's shape ----

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private fun paramsOf(e: JsonElement?): KdfParams? {
        val o = e as? JsonObject ?: return null
        val m = (o["m"] as? JsonPrimitive)?.intOrNull ?: return null
        val tt = (o["t"] as? JsonPrimitive)?.intOrNull ?: return null
        val p = (o["p"] as? JsonPrimitive)?.intOrNull ?: return null
        val v = (o["v"] as? JsonPrimitive)?.intOrNull ?: 1
        return KdfParams(m, tt, p, v)
    }

    private fun paramsJson(p: KdfParams) = buildJsonObject {
        put("m", p.m)
        put("t", p.t)
        put("p", p.p)
        put("v", p.v)
    }

    private fun timingsOf(o: JsonObject) = LockTimings(
        autoLockMs = (o["autoLockMs"] as? JsonPrimitive)?.longOrNull ?: 300_000,
        lockOnBlur = (o["lockOnBlur"] as? JsonPrimitive)?.booleanOrNull ?: false,
        blurDelayMs = (o["blurDelayMs"] as? JsonPrimitive)?.longOrNull ?: 0,
    )

    private fun parse(raw: String): LockConfig? = try {
        val o = fish.nexa.net.wireJson.parseToJsonElement(raw).jsonObject
        if ((o["v"] as? JsonPrimitive)?.intOrNull != 1) null else LockConfig(
            salt = o.str("salt") ?: return null,
            params = paramsOf(o["params"]) ?: return null,
            wrapped = o.str("wrapped") ?: return null,
            pub = o.str("pub") ?: return null,
            timings = timingsOf(o),
            failures = (o["failures"] as? JsonPrimitive)?.intOrNull ?: 0,
            numeric = (o["numeric"] as? JsonPrimitive)?.booleanOrNull,
        )
    } catch (_: Exception) {
        null
    }

    private fun encode(c: LockConfig) = buildJsonObject {
        put("v", 1)
        put("salt", c.salt)
        put("params", paramsJson(c.params))
        put("wrapped", c.wrapped)
        put("pub", c.pub)
        put("autoLockMs", c.timings.autoLockMs)
        put("lockOnBlur", c.timings.lockOnBlur)
        put("blurDelayMs", c.timings.blurDelayMs)
        put("failures", c.failures)
        c.numeric?.let { put("numeric", it) }
    }
}

/**
 * AppLockEffect: when the app locks by itself. Idle is no touch or key for
 * the chosen time while the app is on screen, and coming back after being
 * away that long; leaving is the app going off screen (or the screen going
 * dark), after the chosen delay, unless one of the app's own pickers or share
 * sheets is what covered it.
 */
object LockTimers : DefaultLifecycleObserver {
    private val main = Handler(Looper.getMainLooper())
    private var installed = false
    private var foreground = false
    @Volatile private var lastActivity = SystemClock.elapsedRealtime()
    @Volatile private var lastBump = 0L

    /** One of the app's own pickers, cameras or share sheets is in front: leaving for it does not lock. */
    @Volatile var picking = false

    private val idle = Runnable { lockIfIdle() }
    private val away = Runnable { Nexa.auth.lockApp() }

    fun install() = main.post {
        if (installed) return@post
        installed = true
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    private fun config(): LockConfig? {
        val s = Nexa.auth.state.value as? AuthState.Ready ?: return null
        return AppLock.load(s.me.id)
    }

    /** A touch or a key: the idle clock starts again (at most once a second). */
    fun activity() {
        val now = SystemClock.elapsedRealtime()
        lastActivity = now
        if (now - lastBump < 1000) return
        lastBump = now
        rearm()
    }

    /** The timings changed, the lock was turned on or off, or the app was unlocked. */
    fun rearm() = main.post {
        main.removeCallbacks(idle)
        val ms = config()?.timings?.autoLockMs ?: return@post
        if (foreground && ms > 0) main.postDelayed(idle, maxOf(0L, ms - (SystemClock.elapsedRealtime() - lastActivity)))
    }

    private fun lockIfIdle() {
        val ms = config()?.timings?.autoLockMs ?: return
        if (ms <= 0) return
        val quiet = SystemClock.elapsedRealtime() - lastActivity
        if (quiet >= ms) Nexa.auth.lockApp() else main.postDelayed(idle, ms - quiet)
    }

    override fun onStart(owner: LifecycleOwner) {
        foreground = true
        picking = false
        main.removeCallbacks(away)
        val ms = config()?.timings?.autoLockMs ?: 0
        if (ms > 0 && SystemClock.elapsedRealtime() - lastActivity >= ms) Nexa.auth.lockApp() else rearm()
    }

    override fun onStop(owner: LifecycleOwner) {
        foreground = false
        main.removeCallbacks(idle)
        val t = config()?.timings ?: return
        if (!t.lockOnBlur || picking) return
        if (t.blurDelayMs <= 0) Nexa.auth.lockApp() else main.postDelayed(away, t.blurDelayMs)
    }
}

/**
 * Unlocking with a fingerprint or face, on this phone only (the web has no
 * such thing): a second wrapped copy of the identity, sealed with a key in
 * the phone's keystore that only a strong biometric can use. It goes with the
 * passcode (ten wrong tries, removing it, signing out), and a fingerprint
 * enrolled later voids it.
 */
object BiometricLock {
    private fun alias(userId: String) = "nexa-lock-bio-$userId"
    private fun name(userId: String) = "lockbio-$userId"

    /** A strong fingerprint or face is set up on this phone (Android 11 and later). */
    fun available(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 30) return false
        val bm = context.getSystemService(android.hardware.biometrics.BiometricManager::class.java) ?: return false
        return bm.canAuthenticate(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS
    }

    fun enabled(userId: String): Boolean = Nexa.secure.get(name(userId)) != null

    fun forget(userId: String) {
        Nexa.secure.delete(name(userId))
        runCatching { keystore().deleteEntry(alias(userId)) }
    }

    private fun keystore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun newKey(userId: String): SecretKey {
        val spec = KeyGenParameterSpec.Builder(alias(userId), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(spec.build())
            generateKey()
        }
    }

    /**
     * Asks for a fingerprint or face, then seals [privateKey] so one opens it
     * next time. [done] hears null when it worked, "" when the person backed
     * out, or what went wrong.
     */
    fun enable(context: Context, userId: String, privateKey: ByteArray, done: (String?) -> Unit) {
        if (Build.VERSION.SDK_INT < 30) return done(t("modals.confirm.somethingWentWrong"))
        val cipher = try {
            forget(userId)
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, newKey(userId)) }
        } catch (e: Exception) {
            return done(t("modals.confirm.somethingWentWrong"))
        }
        prompt(context, cipher, t("android.settings.security.biometricConfirm"), { c ->
            try {
                val sealed = Bytes.concat(c.iv, c.doFinal(privateKey))
                Nexa.secure.put(name(userId), sealed)
                done(null)
            } catch (_: Exception) {
                forget(userId)
                done(t("modals.confirm.somethingWentWrong"))
            }
        }, { err ->
            forget(userId)
            done(err ?: "")
        })
    }

    /** Asks for a fingerprint or face and opens the identity with it; [done] hears it, or why not ("" for backing out). */
    fun unlock(context: Context, userId: String, publicKey: ByteArray, done: (Identity?, String?) -> Unit) {
        val sealed = Nexa.secure.get(name(userId))
        if (Build.VERSION.SDK_INT < 30 || sealed == null || sealed.size < 13) return done(null, "")
        val cipher = try {
            val key = keystore().getKey(alias(userId), null) as? SecretKey ?: throw KeyPermanentlyInvalidatedException()
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 0, 12)) }
        } catch (_: KeyPermanentlyInvalidatedException) {
            // a fingerprint or face was added since: this copy can never open again
            forget(userId)
            return done(null, t("android.lock.biometricChanged"))
        } catch (_: Exception) {
            return done(null, t("modals.confirm.somethingWentWrong"))
        }
        prompt(context, cipher, t("android.lock.biometricTitle"), { c ->
            val priv = try {
                c.doFinal(sealed, 12, sealed.size - 12)
            } catch (_: Exception) {
                null
            }
            if (priv == null || !Identity.publicKeyOf(priv).contentEquals(publicKey)) done(null, t("modals.confirm.somethingWentWrong"))
            else done(Identity(publicKey, priv), null)
        }, { err -> done(null, err ?: "") })
    }

    private fun prompt(context: Context, cipher: Cipher, title: String, ok: (Cipher) -> Unit, fail: (String?) -> Unit) {
        if (Build.VERSION.SDK_INT < 30) return fail(null)
        val executor = context.mainExecutor
        val p = android.hardware.biometrics.BiometricPrompt.Builder(context)
            .setTitle(title)
            .setNegativeButton(t("android.lock.usePasscode"), executor) { _, _ -> fail(null) }
            .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build()
        p.authenticate(
            android.hardware.biometrics.BiometricPrompt.CryptoObject(cipher),
            CancellationSignal(),
            executor,
            object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult) {
                    val c = result.cryptoObject?.cipher
                    if (c == null) fail(t("modals.confirm.somethingWentWrong")) else ok(c)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val quiet = errorCode == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED ||
                        errorCode == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                    fail(if (quiet) null else errString.toString())
                }
            },
        )
    }
}
