package fish.nexa.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.data.AppLock
import fish.nexa.data.AuthState
import fish.nexa.data.BiometricLock
import fish.nexa.data.WrongPasscode
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * PasscodePage: the passcode this device asks for, or (adopting) the
 * account's passcode being taken on here. With a fingerprint or face set up
 * for it, the phone asks for that first.
 */
@Composable
fun PasscodeScreen(state: AuthState.PinLocked) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val record = remember(state) { AppLock.load(state.me.id) }
    var passcode by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // a wrong passcode is said on its field, which moves nothing; the rest goes above
    var banner by remember { mutableStateOf<String?>(null) }
    var wrong by remember { mutableStateOf<String?>(null) }
    var left by remember { mutableIntStateOf(AppLock.triesLeft(state.me.id)) }
    var inCall by remember { mutableStateOf(AppLock.inCall()) }
    val focus = remember { FocusRequester() }
    val biometric = !state.adopting && record != null && BiometricLock.available(ctx) && BiometricLock.enabled(state.me.id)

    fun useBiometric() {
        val pub = record?.pub?.let { Bytes.unb64OrNull(it) } ?: return
        BiometricLock.unlock(ctx, state.me.id, pub) { identity, err ->
            if (identity != null) Nexa.auth.unlockWithBiometric(identity) else if (!err.isNullOrEmpty()) banner = err
        }
    }

    LaunchedEffect(Unit) {
        runCatching { focus.requestFocus() }
        if (biometric) useBiometric()
    }
    // a call carries on behind the lock, so leaving it is the one thing to do here without unlocking
    LaunchedEffect(Unit) {
        while (true) {
            inCall = AppLock.inCall()
            delay(1000)
        }
    }

    fun submit() {
        if (busy || passcode.isEmpty()) return
        busy = true
        banner = null
        wrong = null
        scope.launch {
            try {
                Nexa.auth.unlockWithPasscode(passcode)
            } catch (e: WrongPasscode) {
                passcode = ""
                e.left?.let { left = it }
                if (e.left == null || e.left > 0) wrong = e.message else banner = t("passcode.tooManyWrongTriesLogIn")
                runCatching { focus.requestFocus() }
            } catch (e: Exception) {
                passcode = ""
                banner = describeError(e, t("passcode.thatDidNotWork"))
                runCatching { focus.requestFocus() }
            } finally {
                busy = false
            }
        }
    }

    val name = state.me.displayName.ifBlank { state.me.username }.ifBlank { t("passcode.you") }
    AuthLayout(
        if (state.adopting) t("passcode.thisAccountHasAPasscode") else t("passcode.locked"),
        if (state.adopting) t("passcode.enterItToFinishSettingThis") else t("passcode.enterYourPasscodeToUnlock", "name" to fish.nexa.ui.chat.PERSON_SLOT),
        maxWidth = 420,
        subtitlePersonId = state.me.id, subtitleName = name, subtitleNameStyle = state.me.nameStyle,
    ) {
        if (inCall) CallStillOn {
            AppLock.leaveCall()
            runCatching { focus.requestFocus() }
        }
        banner?.let { ErrorBox(it) }
        NxTextField(
            passcode,
            {
                passcode = it
                wrong = null
            },
            modifier = Modifier.focusRequester(focus),
            label = t("settings.security.passcode"),
            required = true,
            password = true,
            keyboardType = if (record?.numeric == true) KeyboardType.NumberPassword else KeyboardType.Password,
            error = wrong,
            imeAction = ImeAction.Go,
            onIme = { submit() },
        )
        if (left <= 3 && !state.adopting) Warning(t("passcode.triesLeft", "count" to left) + " " + t("passcode.thenSignInWithPassword"))
        NxButton(if (state.adopting) t("passcode.setUpThisDevice") else t("lock.unlock"), { submit() }, size = ButtonSize.LG, block = true, loading = busy)
        if (biometric) NxButton(t("android.lock.useBiometric"), { useBiometric() }, kind = ButtonKind.SECONDARY, size = ButtonSize.LG, block = true, icon = "Fingerprint")
        NxButton(t("passcode.useMyPasswordInstead"), { scope.launch { Nexa.auth.logout() } }, kind = ButtonKind.LINK, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

/** `.call`: a green box saying the call goes on, with the button that ends it. */
@Composable
private fun ColumnScope.CallStillOn(leave: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.positive.copy(alpha = 0.12f), Radii.Sm)
            .border(1.dp, c.positive.copy(alpha = 0.45f), Radii.Sm)
            .padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Txt(t("passcode.stillInACall"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20f)), color = c.text, modifier = Modifier.weight(1f))
        NxButton(t("passcode.leaveCall"), leave, kind = ButtonKind.DANGER, size = ButtonSize.SM)
    }
}

/** `.warn`: the amber box for the last few tries. */
@Composable
private fun Warning(text: String) {
    val c = Nx.colors
    Box(
        Modifier
            .fillMaxWidth()
            .background(c.warning.copy(alpha = 0.12f), Radii.Sm)
            .border(1.dp, c.warning.copy(alpha = 0.5f), Radii.Sm)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) { Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.text) }
}
