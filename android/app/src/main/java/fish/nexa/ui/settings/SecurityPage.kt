package fish.nexa.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Fingerprint
import fish.nexa.data.AppLock
import fish.nexa.data.BiometricLock
import fish.nexa.data.LockTimings
import fish.nexa.net.MeUser
import fish.nexa.net.MfaStatus
import fish.nexa.net.TotpSetup
import fish.nexa.net.wireJson
import fish.nexa.ui.Time
import fish.nexa.ui.auth.ErrorBox
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** 3.3 Security: two-factor sign-in, the passcode, and the encryption keys. */
@Composable
fun SecurityPage() {
    PageTitle(t("settings.security.security"))
    TwoFactorSection()
    PasskeysSection()
    AppLockSection()
    EncryptionSection()
}

/** The password's auth key, for the prompts on this page (authKeyFor). */
private suspend fun authKey(password: String): String = Bytes.b64(Nexa.auth.currentAuthKey(password))

private fun JsonObject.codes(): List<String> = (this["backup_codes"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

// ---- A: two-factor ----

@Composable
private fun TwoFactorSection() {
    val scope = rememberCoroutineScope()
    // checking, failed, or known
    var mfa by remember { mutableStateOf<MfaStatus?>(null) }
    var failed by remember { mutableStateOf(false) }
    suspend fun refresh() {
        try {
            mfa = Nexa.api.get("/auth/mfa", MfaStatus.serializer())
            failed = false
        } catch (_: Exception) {
            if (mfa == null) failed = true
        }
        try {
            val fresh = Nexa.api.get("/users/@me", MeUser.serializer())
            Nexa.users.setMe(fresh.copy(nexa = fresh.nexa ?: Nexa.users.me.value?.nexa))
        } catch (_: Exception) {
        }
    }
    LaunchedEffect(Unit) { refresh() }
    val again: () -> Unit = { scope.launch { refresh() } }

    SectionHeading(t("settings.security.twoFactorAuthentication"), Modifier.settingAnchor("twoFactor"), first = true, icon = "Shield")
    Hint(t("settings.security.anAuthenticatorAppAdds"), Modifier.padding(bottom = 14.dp))
    val m = mfa
    when {
        m == null && !failed -> DeviceRow(t("settings.security.checkingYourTwoFactorStatus"), t("settings.security.oneMoment"), "ShieldQuestion", actions = { Spinner(size = 24.dp) })
        m == null -> DeviceRow(t("settings.security.twoFactorStatusUnknown"), t("settings.security.weCouldNotAskTheServer"), "ShieldAlert", actions = {
            NxButton(t("chat.messageList.tryAgain"), {
                failed = false
                again()
            }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        })
        m.enabled -> {
            val sub = t("settings.security.backupCodesLeftCount", "count" to m.backupCodesLeft) +
                (m.enabledAt?.let { t("settings.security.onSince", "when" to Time.dateDivider(it)) } ?: "")
            DeviceRow(t("settings.security.authenticatorAppIsOn"), sub, "ShieldCheck", current = true, actions = {
                NxButton(t("settings.security.backupCodes"), { openCodesSheet(m.backupCodesLeft, again) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                NxButton(t("settings.security.turnOff"), { openDisableSheet(again) }, kind = ButtonKind.DANGER, size = ButtonSize.SM)
            })
            if (m.backupCodesLeft == 0) NoticeBox(t("settings.security.youHaveNoBackupCodesLeft"), Nx.colors.danger)
        }
        else -> DeviceRow(t("settings.security.authenticatorAppIsOff"), t("settings.security.worksWithAnyTotpApp"), "Shield", actions = {
            NxButton(t("settings.security.setUp"), { openEnableSheet(again) }, size = ButtonSize.SM)
        })
    }
}

/** The person's name for files of codes. */
private fun username() = Nexa.users.me.value?.username ?: ""

/** BackupCodes: ten codes shown once, to copy or save, ticked off before Done. */
@Composable
private fun BackupCodes(codes: List<String>, onDone: () -> Unit) {
    val joined = codes.joinToString("\n")
    KeyToSave(
        value = joined,
        display = joined,
        fileName = "nexa-backup-codes-${username()}.txt",
        fileText = t("settings.security.backupCodesFileHeading", "username" to username()) + "\n" + t("settings.security.eachCodeWorksOnce") + "\n\n" + joined + "\n",
        warning = t("settings.security.saveTheseNowTheyAreShown"),
        confirm = t("settings.security.iHaveSavedTheseCodes"),
        copyFailed = t("settings.security.couldNotReachTheClipboardSelect"),
        downloadLabel = t("chat.attachments.download"),
        onDone = onDone,
        copyFor = 1500,
        warningFirst = true,
    )
}

/** Set Up: the password, then the code to scan (or open in an authenticator here), then the backup codes. */
private fun openEnableSheet(refresh: () -> Unit) {
    val ctl = SheetCtl(t("settings.security.setUpTwoFactorAuthentication"))
    var password by mutableStateOf("")
    var setup by mutableStateOf<TotpSetup?>(null)
    var code by mutableStateOf("")
    var codes by mutableStateOf<List<String>?>(null)
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    fun start() {
        if (busy || password.isEmpty()) return
        busy = true
        error = null
        onMain {
            try {
                val res = Nexa.api.request("POST", "/auth/mfa/totp/setup", buildJsonObject { put("auth_key", authKey(password)) })
                setup = wireJson.decodeFromJsonElement(TotpSetup.serializer(), res)
                password = ""
                ctl.title = t("settings.security.scanThisWithYourAuthenticator")
            } catch (e: Exception) {
                error = describeError(e)
            } finally {
                busy = false
            }
        }
    }
    fun enable() {
        val s = setup ?: return
        if (busy || code.length != 6) return
        busy = true
        error = null
        onMain {
            try {
                val res = Nexa.api.request("POST", "/auth/mfa/totp/enable", buildJsonObject {
                    put("ticket", s.ticket)
                    put("code", code)
                }) as? JsonObject
                codes = res?.codes() ?: emptyList()
                refresh()
                Nexa.ui.toast(t("settings.security.twoFactorAuthenticationIsOn"), "success")
                ctl.title = t("settings.security.saveYourBackupCodes")
                ctl.closable = false
            } catch (e: Exception) {
                error = describeError(e)
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("mfa-enable", ctl) { sheet ->
        val ctx = LocalContext.current
        val done = codes
        val s = setup
        if (done != null) {
            BackupCodes(done) { sheet.close() }
            return@openSettingsSheet
        }
        error?.let { ErrorBox(it) }
        if (s == null) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
            Hint(t("settings.security.confirmYourPasswordToStart"))
            NxTextField(password, { password = it }, Modifier.focusRequester(focus), label = t("chat.lockedChannel.password"), required = true, password = true, imeAction = ImeAction.Done, onIme = { start() })
            NxButton(t("settings.security.continue"), { start() }, block = true, size = ButtonSize.LG, loading = busy, enabled = password.isNotEmpty())
        } else {
            var showKey by remember { mutableStateOf(false) }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                QrCode(s.uri, 188.dp, t("settings.security.authenticatorSetupCode"))
            }
            // most people set the authenticator up on this same phone, where a code on its screen cannot be scanned
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NxButton(t("android.settings.security.openAuthenticator"), {
                    try {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(s.uri)))
                    } catch (_: Exception) {
                        Nexa.ui.toast(t("android.settings.security.noAuthenticator"), "error")
                    }
                }, kind = ButtonKind.SECONDARY, icon = "ExternalLink", modifier = Modifier.weight(1f), block = true)
                NxButton(t("android.settings.security.copyKey"), {
                    if (copyText(ctx, s.secret, sensitive = true)) Nexa.ui.toast(t("chat.groupMemberMenu.copied"), "success")
                    else Nexa.ui.toast(t("common.copyFailed"), "error")
                }, kind = ButtonKind.SECONDARY, icon = "Copy", modifier = Modifier.weight(1f), block = true)
            }
            NxButton(
                if (showKey) t("settings.security.hideTheKey") else t("settings.security.canTScanIt"),
                { showKey = !showKey },
                kind = ButtonKind.LINK, modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            if (showKey) MonoBox(s.formatted.ifEmpty { s.secret }, center = true)
            NxTextField(
                code,
                { v ->
                    code = v.filter { it in '0'..'9' }.take(6)
                    error = null
                },
                label = t("settings.security.enterTheSixDigitCodeIt"),
                placeholder = "123456",
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Done,
                onIme = { enable() },
                mono = true,
            )
            NxButton(t("settings.security.turnOn"), { enable() }, block = true, size = ButtonSize.LG, loading = busy, enabled = code.length == 6)
        }
    }
}

/** Backup Codes: a new set (the old one stops working), shown once. */
private fun openCodesSheet(left: Int, refresh: () -> Unit) {
    val ctl = SheetCtl(t("settings.security.backupCodes"))
    var password by mutableStateOf("")
    var codes by mutableStateOf<List<String>?>(null)
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    fun submit() {
        if (busy || password.isEmpty()) return
        busy = true
        error = null
        onMain {
            try {
                val res = Nexa.api.request("POST", "/auth/mfa/backup", buildJsonObject { put("auth_key", authKey(password)) }) as? JsonObject
                codes = res?.codes() ?: emptyList()
                password = ""
                refresh()
                ctl.title = t("settings.security.saveYourBackupCodes")
                ctl.closable = false
            } catch (e: Exception) {
                error = describeError(e)
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("mfa-codes", ctl) { sheet ->
        val done = codes
        if (done != null) {
            BackupCodes(done) { sheet.close() }
            return@openSettingsSheet
        }
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        error?.let { ErrorBox(it) }
        Hint(t("settings.security.backupCodesHint") + " " + t("settings.security.backupCodesLeft", "count" to left))
        NxTextField(password, { password = it }, Modifier.focusRequester(focus), label = t("chat.lockedChannel.password"), required = true, password = true, imeAction = ImeAction.Done, onIme = { submit() })
        NxButton(t("settings.security.generateNewCodes"), { submit() }, block = true, size = ButtonSize.LG, loading = busy, enabled = password.isNotEmpty())
    }
}

/** Turn Off: the password, then the authenticator and the backup codes are gone. */
private fun openDisableSheet(refresh: () -> Unit) {
    val ctl = SheetCtl(t("settings.security.turnOffTwoFactorAuthentication"))
    var password by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    fun submit() {
        if (busy || password.isEmpty()) return
        busy = true
        error = null
        onMain {
            try {
                Nexa.api.request("POST", "/auth/mfa/disable", buildJsonObject { put("auth_key", authKey(password)) })
                refresh()
                ctl.close()
                Nexa.ui.toast(t("settings.security.twoFactorAuthenticationIsOff"), "success")
            } catch (e: Exception) {
                error = describeError(e)
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("mfa-disable", ctl) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        error?.let { ErrorBox(it) }
        Hint(t("settings.security.yourPasswordAloneWillGetInto"))
        NxTextField(password, { password = it }, Modifier.focusRequester(focus), label = t("chat.lockedChannel.password"), required = true, password = true, imeAction = ImeAction.Done, onIme = { submit() })
        NxButton(t("settings.security.turnItOff"), { submit() }, kind = ButtonKind.DANGER, block = true, size = ButtonSize.LG, loading = busy, enabled = password.isNotEmpty())
    }
}

// ---- passkeys (web/src/components/settings/PasskeysSection.tsx) ----

@Composable
private fun PasskeysSection() {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<fish.nexa.data.Passkeys.Info>?>(null) }
    var failed by remember { mutableStateOf(false) }
    suspend fun refresh() {
        try {
            list = fish.nexa.data.Passkeys.list()
            failed = false
        } catch (_: Exception) {
            if (list == null) failed = true
        }
    }
    LaunchedEffect(Unit) { refresh() }
    val again: () -> Unit = { scope.launch { refresh() } }
    val activity = androidx.activity.compose.LocalActivity.current

    SectionHeading(t("passkeys.title"), Modifier.settingAnchor("passkeys"), icon = "KeyRound")
    Hint(t("passkeys.hint"), Modifier.padding(bottom = 14.dp))
    val keys = list
    when {
        keys == null && !failed -> DeviceRow(t("settings.security.oneMoment"), null, "KeyRound", actions = { Spinner(size = 24.dp) })
        keys == null -> DeviceRow(t("settings.security.weCouldNotAskTheServer"), null, "KeyRound", actions = {
            NxButton(t("chat.messageList.tryAgain"), { failed = false; again() }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        })
        else -> {
            val host = android.net.Uri.parse(Nexa.api.baseUrl).host
            for (k in keys) {
                val sub = (if (k.lastUsedAt > 0) t("passkeys.addedAndUsed", "added" to Time.dateDivider(k.createdAt), "used" to Time.dateDivider(k.lastUsedAt)) else t("passkeys.addedOn", "added" to Time.dateDivider(k.createdAt))) +
                    (if (k.rpId != host) "\n" + t("passkeys.worksAt", "site" to k.rpId) else "")
                DeviceRow(k.name.ifBlank { t("passkeys.passkey") }, sub, "KeyRound", actions = {
                    NxButton(t("passkeys.rename"), { openRenamePasskeySheet(k, again) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                    NxButton(t("passkeys.remove"), {
                        fish.nexa.ui.shell.confirm(t("passkeys.removeTitle", "name" to k.name.ifBlank { t("passkeys.passkey") }), t("passkeys.removeBody"), t("passkeys.remove")) {
                            fish.nexa.data.Passkeys.remove(k.id)
                            refresh()
                        }
                    }, kind = ButtonKind.DANGER, size = ButtonSize.SM)
                })
            }
            val supported = fish.nexa.data.Passkeys.supported
            DeviceRow(if (!supported) t("android.passkeys.needsAndroid14") else if (keys.isEmpty()) t("passkeys.none") else t("passkeys.addAnother"), null, null, actions = {
                if (supported && activity != null) NxButton(t("passkeys.add"), { openAddPasskeySheet(activity, again) }, size = ButtonSize.SM)
            })
        }
    }
}

/** Add a Passkey: the password, then the system's sheet. */
private fun openAddPasskeySheet(activity: android.app.Activity, refresh: () -> Unit) {
    val ctl = SheetCtl(t("passkeys.add"))
    var password by mutableStateOf("")
    var name by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    val fallback = describeDevice(Nexa.api.userAgent).label
    fun submit() {
        val identity = Nexa.keys.identity ?: return
        if (busy || password.isEmpty()) return
        busy = true
        error = null
        onMain {
            try {
                fish.nexa.data.Passkeys.add(activity, password, identity, name.trim().ifEmpty { fallback })
                refresh()
                ctl.close()
                Nexa.ui.toast(t("passkeys.added"), "success")
            } catch (e: Exception) {
                if (!fish.nexa.data.Passkeys.cancelled(e)) error = describeError(e, t("passkeys.couldNotAdd"))
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("passkey-add", ctl) {
        error?.let { ErrorBox(it) }
        Hint(t("passkeys.addHint"))
        NxTextField(password, { password = it }, label = t("chat.lockedChannel.password"), required = true, password = true, imeAction = ImeAction.Next)
        NxTextField(name, { name = it.take(64) }, label = t("passkeys.name"), placeholder = fallback, imeAction = ImeAction.Done, onIme = { submit() })
        NxButton(t("settings.security.continue"), { submit() }, block = true, size = ButtonSize.LG, loading = busy, enabled = password.isNotEmpty())
    }
}

private fun openRenamePasskeySheet(key: fish.nexa.data.Passkeys.Info, refresh: () -> Unit) {
    val ctl = SheetCtl(t("passkeys.rename"))
    var name by mutableStateOf(key.name)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    fun submit() {
        if (busy) return
        busy = true
        onMain {
            try {
                fish.nexa.data.Passkeys.rename(key.id, name.trim())
                refresh()
                ctl.close()
            } catch (e: Exception) {
                error = describeError(e)
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("passkey-rename", ctl) {
        error?.let { ErrorBox(it) }
        NxTextField(name, { name = it.take(64) }, label = t("passkeys.name"), imeAction = ImeAction.Done, onIme = { submit() })
        NxButton(t("passkeys.save"), { submit() }, block = true, size = ButtonSize.LG, loading = busy)
    }
}

// ---- B: the passcode ----

private fun autoLockChoices() = listOf(
    t("modals.groupInvite.never") to 0L,
    t("appLock.1Minute") to 60_000L,
    t("server.memberAction.5Minutes") to 300_000L,
    t("appLock.15Minutes") to 900_000L,
    t("modals.customStatus.1Hour") to 3_600_000L,
)

private fun blurDelayChoices() = listOf(
    t("appLock.immediately") to 0L,
    t("appLock.after30Seconds") to 30_000L,
    t("appLock.after5Minutes") to 300_000L,
)

@Composable
private fun AppLockSection() {
    val c = Nx.colors
    val ctx = LocalContext.current
    val me = Nexa.users.me.collectAsState().value ?: return
    val doc = settingsDoc()
    val policy = AppLock.policySet(doc)
    // the device record is not observable: this count is bumped whenever it is changed from here
    var version by remember { mutableIntStateOf(0) }
    val lock = remember(version, me.id, doc["appLock"]) { AppLock.load(me.id) }
    val bump: () -> Unit = { version++ }

    SectionHeading(t("settings.security.appLock"), Modifier.settingAnchor("appLock"), icon = "Lock")
    Hint(t("settings.security.appLockHint"), Modifier.padding(bottom = 14.dp))
    if (policy) DeviceRow(t("settings.security.passcodeIsOnForThisAccount"), t("settings.security.everyDeviceYouSignInOn"), "LockKeyhole", current = true, actions = {
        NxButton(t("settings.security.change"), { openPasscodeSheet(lock != null, bump) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        NxButton(t("composer.composer.remove"), { openRemovePasscodeSheet(bump) }, kind = ButtonKind.DANGER, size = ButtonSize.SM)
    }) else DeviceRow(t("settings.security.noPasscodeSet"), t("settings.security.theAppOpensStraightIntoYour"), "LockOpen", actions = {
        NxButton(t("settings.security.setAPasscode"), { openPasscodeSheet(lock != null, bump) }, size = ButtonSize.SM)
    })
    if (lock == null) return
    val timings = lock.timings
    fun set(next: LockTimings) {
        Nexa.auth.setLockTimings(next)
        bump()
    }
    Column(
        Modifier
            .padding(top = 6.dp)
            .fillMaxWidth()
            .sunken(Radii.Md, c)
            .ring(Radii.Md, c.borderSubtle)
            .padding(horizontal = 14.dp),
    ) {
        SelectRow(t("settings.security.lockAfterInactivity"), timings.autoLockMs, autoLockChoices(), { set(timings.copy(autoLockMs = it)) }, sub = t("android.settings.security.idleHint"))
        ToggleRow(t("settings.security.lockWhenTheAppLosesFocus"), timings.lockOnBlur, { set(timings.copy(lockOnBlur = it)) }, t("android.settings.security.leaveHint"))
        if (timings.lockOnBlur) SelectRow(t("settings.security.lockOnceItIsInThe"), timings.blurDelayMs, blurDelayChoices(), { set(timings.copy(blurDelayMs = it)) })
        if (BiometricLock.available(ctx)) {
            val on = remember(version) { BiometricLock.enabled(me.id) }
            ToggleRow(t("android.settings.security.biometric"), on, { want ->
                if (!want) {
                    BiometricLock.forget(me.id)
                    bump()
                } else {
                    val identity = Nexa.keys.identity ?: return@ToggleRow
                    BiometricLock.enable(ctx, me.id, identity.privateKey) { err ->
                        if (err == null) Nexa.ui.toast(t("android.settings.security.biometricOn"), "success")
                        else if (err.isNotEmpty()) Nexa.ui.toast(err, "error")
                        bump()
                    }
                }
            }, t("android.settings.security.biometricHint"))
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Txt(t("settings.security.lockRightNow"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = c.text, modifier = Modifier.weight(1f))
            NxButton(t("settings.security.lock"), { Nexa.auth.lockApp() }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Lock")
        }
    }
}

/** Set a Passcode / Change Your Passcode: typed twice, held to the passcode rules. */
private fun openPasscodeSheet(hasRecord: Boolean, onDone: () -> Unit) {
    val ctl = SheetCtl(t(if (hasRecord) "settings.security.changeYourPasscode" else "settings.security.setAPasscode"))
    var pin by mutableStateOf("")
    var again by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    fun submit() {
        if (busy || pin.isEmpty() || again.isEmpty()) return
        val problem = AppLock.problem(pin) ?: if (pin != again) t("settings.security.thoseTwoPasscodesAreDifferent") else null
        if (problem != null) {
            error = problem
            return
        }
        busy = true
        error = null
        ctl.closable = false
        onMain {
            try {
                Nexa.auth.setPasscode(pin)
                Nexa.ui.toast(t("settings.security.thisDeviceNowAsksForYour"), "success")
                ctl.close()
                onDone()
            } catch (e: Exception) {
                error = describeError(e)
                ctl.closable = true
            } finally {
                busy = false
            }
        }
    }
    openSettingsSheet("passcode", ctl) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        error?.let { ErrorBox(it) }
        Hint(t("settings.security.digitsOrAPhraseAtLeast"))
        NxTextField(pin, {
            pin = it
            error = null
        }, Modifier.focusRequester(focus), label = t("settings.security.passcode"), password = true)
        NxTextField(again, {
            again = it
            error = null
        }, label = t("settings.security.passcodeAgain"), password = true, imeAction = ImeAction.Done, onIme = { submit() })
        NxButton(t(if (hasRecord) "settings.security.changeIt" else "settings.security.turnItOn"), { submit() }, block = true, size = ButtonSize.LG, loading = busy, enabled = pin.isNotEmpty() && again.isNotEmpty())
    }
}

/** Remove the Passcode: no passcode asked for, the app is open already. */
private fun openRemovePasscodeSheet(onDone: () -> Unit) {
    val ctl = SheetCtl(t("settings.security.removeThePasscode"))
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    openSettingsSheet("passcode-remove", ctl) {
        error?.let { ErrorBox(it) }
        Hint(t("settings.security.thisDeviceGoesBackToKeeping"))
        NxButton(t("settings.security.removeIt"), {
            if (busy) return@NxButton
            busy = true
            error = null
            ctl.closable = false
            onMain {
                try {
                    Nexa.auth.removePasscode()
                    Nexa.ui.toast(t("settings.security.passcodeRemoved"), "success")
                    ctl.close()
                    onDone()
                } catch (e: Exception) {
                    error = describeError(e)
                    ctl.closable = true
                } finally {
                    busy = false
                }
            }
        }, kind = ButtonKind.DANGER, block = true, size = ButtonSize.LG, loading = busy)
    }
}

// ---- C: encryption keys ----

/** Opens the queue of changed keys to accept or not; the profile part's dialog when there is one. */
object KeyChangeReview {
    var open: () -> Unit = { openKeyChangeSheet() }
}

/** The safety number for a key (base64), worked out off the main thread: 5200 hashes. */
@Composable
private fun safetyNumber(key: String?): String? = produceState<String?>(null, key) {
    value = key?.let { withContext(Dispatchers.Default) { Fingerprint.ofB64(it) } }
}.value

@Composable
private fun EncryptionSection() {
    val c = Nx.colors
    val ctx = LocalContext.current
    val me = Nexa.users.me.collectAsState().value ?: return
    val events by Nexa.alerts.events.collectAsState()
    val pending by Nexa.alerts.pending.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val myKey = Nexa.keys.identity?.publicKey?.let { Bytes.b64(it) } ?: me.publicKey.ifEmpty { null }
    val digits = safetyNumber(myKey)
    var qr by remember { mutableStateOf(false) }

    SectionHeading(t("encryption.sectionTitle"), Modifier.settingAnchor("encryption"), icon = "KeyRound")
    Hint(t("encryption.sectionHint"), Modifier.padding(bottom = 14.dp))
    SettingsCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(t("encryption.yourSafetyNumber"), style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong)
            Txt(t("encryption.yourSafetyNumberHint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19f)), color = c.textMuted)
            if (myKey == null) Txt(t("encryption.noKeyToShow"), style = Nx.type.bodySmall, color = c.textMuted)
            else if (digits == null) Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { Spinner() }
            else {
                // six groups of five, in two lines of three, as easy to read aloud as to compare
                val groups = digits.split(" ")
                MonoBox(groups.chunked(3).joinToString("\n") { it.joinToString("  ") }, center = true, size = 18f)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxButton(t("modals.groupInvite.copy"), {
                        if (copyText(ctx, digits)) Nexa.ui.toast(t("chat.groupMemberMenu.copied"), "success") else Nexa.ui.toast(t("common.copyFailed"), "error")
                    }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Copy")
                    NxButton(if (qr) t("encryption.hideCode") else t("encryption.showCode"), { qr = !qr }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "QrCode")
                }
                if (qr) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QrCode(digits, 168.dp, t("encryption.safetyNumberQr")) }
            }
        }
    }
    Box(Modifier.padding(top = 12.dp)) {
        val has = remember(pending, events) { Nexa.pins.count() > 0 }
        DeviceRow(
            if (has) t("encryption.rememberingKeys") else t("encryption.rememberingNothingYet"),
            if (has) t("encryption.rememberingSince", "when" to Time.dateDivider(Nexa.pins.since())) else t("encryption.rememberingNothingYetSub"),
            "Fingerprint",
            actions = if (pending.isEmpty()) null else {
                { NxButton(t("encryption.reviewChanges", "count" to pending.size), { KeyChangeReview.open() }, kind = ButtonKind.DANGER, size = ButtonSize.SM) }
            },
        )
    }
    if (events.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 6.dp), horizontalArrangement = Arrangement.End) {
            NxButton(t("encryption.clearLog"), { Nexa.alerts.clearEvents() }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
        }
        Column(
            Modifier.fillMaxWidth().sunken(Radii.Md, c).ring(Radii.Md, c.borderSubtle).padding(horizontal = 14.dp, vertical = 4.dp),
        ) {
            events.take(20).forEachIndexed { i, e ->
                if (i > 0) Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
                val name = e.userId?.let { users[it]?.name } ?: t("names.unknownUser")
                val sentence = when (e.kind) {
                    "key_changed" -> t("encryption.logKeyChanged", "name" to fish.nexa.ui.chat.PERSON_SLOT)
                    "outsider_refused" -> t("encryption.logOutsiderRefused", "count" to (e.count ?: 1))
                    "grant_withheld" -> t("encryption.logGrantWithheld", "name" to fish.nexa.ui.chat.PERSON_SLOT)
                    else -> t("encryption.logUnchecked", "count" to (e.count ?: 1))
                }
                Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                    fish.nexa.ui.chat.PersonText(e.userId, sentence, name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text)
                    Txt(Time.dateDivider(e.at), style = Nx.type.hint, color = c.textMuted)
                }
            }
        }
    }
}

/** KeyChangeModal: the first changed key waiting, both safety numbers, Not Now or Accept New Key. */
private fun openKeyChangeSheet() {
    val first = Nexa.alerts.pending.value.values.minByOrNull { it.firstSeen } ?: return
    val name = Nexa.users.get(first.userId)?.name ?: t("names.unknownUser")
    val ctl = SheetCtl(t("encryption.keyChangedTitle", "name" to name)).apply { titleWords = fish.nexa.ui.chat.PersonWords(t("encryption.keyChangedTitle", "name" to fish.nexa.ui.chat.PERSON_SLOT), listOf(first.userId to name)) }
    openSettingsSheet("key-change", ctl, footer = {
        NxButton(t("encryption.keyChangedNotNow"), {
            Nexa.alerts.reject(first.userId)
            it.close()
        }, kind = ButtonKind.GHOST)
        NxButton(t("encryption.keyChangedAccept"), {
            Nexa.alerts.accept(first.userId)
            Nexa.scope.launch { runCatching { Nexa.keys.reconcile() } }
            it.close()
        }, kind = ButtonKind.DANGER)
    }) {
        val c = Nx.colors
        NoticeBox(t("encryption.keyChangedWarning", "name" to fish.nexa.ui.chat.PERSON_SLOT), c.warning, personId = first.userId, personName = name)
        Txt(t("encryption.keyChangedNewLabel"), style = Nx.type.label, color = c.textSubtle)
        MonoBox(safetyNumber(first.offered) ?: "…", center = true)
        Txt(t("encryption.keyChangedOldLabel"), style = Nx.type.label, color = c.textSubtle)
        MonoBox(safetyNumber(first.pinned) ?: "…", center = true)
        fish.nexa.ui.chat.PersonText(first.userId, t("encryption.keyChangedMeaning", "name" to fish.nexa.ui.chat.PERSON_SLOT), name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
        val more = Nexa.alerts.pending.value.size - 1
        if (more > 0) Txt(t("encryption.keyChangedMore", "count" to more), style = Nx.type.bodySmall, color = c.textMuted)
    }
}
