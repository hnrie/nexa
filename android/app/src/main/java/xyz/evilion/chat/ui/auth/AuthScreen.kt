package xyz.evilion.chat.ui.auth

import xyz.evilion.chat.R
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Captcha
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SecureStore
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.ui.theme.chatColors

private enum class Mode { SIGN_IN, REGISTER, RECOVER, MFA, UNLOCK }

/**
 * Signing in, joining and getting an account back.
 *
 * Everything here happens on the device: the password is stretched with
 * argon2id and split into the key the server checks and the key that unwraps
 * this account's identity. Neither the password nor the identity key is ever
 * sent.
 */
@Composable
fun AuthScreen(locked: Boolean = false) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(if (locked) Mode.UNLOCK else Mode.SIGN_IN) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var inviteCode by remember { mutableStateOf("") }
    var registrationKey by remember { mutableStateOf("") }
    var recoveryKey by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var useBackupCode by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showPassword by remember { mutableStateOf(false) }
    var changingServer by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }
    val instance by AppState.instance.collectAsState()

    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                block()
            } catch (e: Captcha.Cancelled) {
                error = null
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = e.message ?: t("modals.confirm.somethingWentWrong")
            } finally {
                busy = false
            }
        }
    }

    fun signIn() = run {
        val outcome = Session.login(username.trim(), password)
        if (outcome.mfaRequired) {
            code = ""
            mode = Mode.MFA
        }
    }

    fun createAccount() {
        if (password != confirm) {
            error = t("auth.authScreen.thosePasswordsDoNotMatch")
            return
        }
        if (password.length < 8) {
            error = t("auth.authScreen.useAtLeast8Characters")
            return
        }
        run {
            Session.register(
                username.trim(), displayName.trim().ifEmpty { username.trim() }, password,
                inviteCode.trim().ifEmpty { null }, registrationKey.trim().ifEmpty { null },
            )
        }
    }

    fun recoverAccount() = run { Session.recover(username.trim(), recoveryKey.trim(), password) }

    fun submitMfa() = run {
        if (useBackupCode) Session.completeMfa(null, code.trim()) else Session.completeMfa(code.trim(), null)
    }

    fun unlockDevice() = run { Session.unlock(password) }

    // One inset for the keyboard and the navigation bar together: padding for
    // both leaves a nav bar's worth of empty screen above an open keyboard,
    // which on a short form is the difference between reaching the button and
    // not.
    Box(
        Modifier.fillMaxSize().background(colors.bgBase).statusBarsPadding()
            .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // the app's own mark, not the initials of whatever the instance is called
            Box(
                Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(colors.brand),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(R.drawable.nexa_mark),
                    null,
                    tint = colors.onBrand,
                    modifier = Modifier.size(38.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                when (mode) {
                    Mode.SIGN_IN -> t("auth.authScreen.welcomeBack")
                    Mode.REGISTER -> t("home.hero.start")
                    Mode.RECOVER -> t("auth.authScreen.getYourAccountBack")
                    Mode.MFA -> t("login.oneMoreStep")
                    Mode.UNLOCK -> t("auth.authScreen.unlockThisDevice")
                },
                style = MaterialTheme.typography.titleLarge,
                color = colors.textStrong,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                when (mode) {
                    Mode.SIGN_IN -> instance?.name?.ifEmpty { null } ?: "Nexa"
                    Mode.REGISTER -> t("auth.authScreen.yourPasswordNeverLeavesThisDevice")
                    Mode.RECOVER -> t("auth.authScreen.yourRecoveryKeyUnwrapsYourAccount")
                    Mode.MFA -> t("auth.authScreen.enterTheCodeFromYourAuthenticator")
                    Mode.UNLOCK -> t("auth.authScreen.yourPasswordUnlocksTheKeysFor")
                },
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))

            when (mode) {
                Mode.MFA -> {
                    Field(
                        value = code,
                        onChange = { code = it },
                        label = if (useBackupCode) t("login.backupCode") else t("settings.security.enterTheSixDigitCodeIt"),
                        keyboardType = if (useBackupCode) KeyboardType.Text else KeyboardType.NumberPassword,
                        onSubmit = { submitMfa() },
                    )
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(t("settings.security.continue"), busy) { submitMfa() }
                    TextButton(onClick = { useBackupCode = !useBackupCode; code = "" }) {
                        Text(if (useBackupCode) t("auth.authScreen.useYourAuthenticatorApp") else t("login.useABackupCode"), color = colors.textBrand)
                    }
                    TextButton(onClick = { Session.cancelMfa(); mode = Mode.SIGN_IN }) {
                        Text(t("modals.createServer.back"), color = colors.textMuted)
                    }
                }

                Mode.UNLOCK -> {
                    Field(
                        value = password,
                        onChange = { password = it },
                        label = t("chat.lockedChannel.password"),
                        password = !showPassword,
                        onSubmit = { unlockDevice() },
                        trailing = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    if (showPassword) Lucide.EyeOff else Lucide.Eye,
                                    t("auth.authScreen.showPassword"), tint = colors.icon,
                                )
                            }
                        },
                    )
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(t("lock.unlock"), busy) { unlockDevice() }
                    TextButton(onClick = { run { Session.logout() } }) {
                        Text(t("auth.authScreen.signOutInstead"), color = colors.textMuted)
                    }
                }

                Mode.RECOVER -> {
                    Field(username, { username = it }, t("settings.account.username"))
                    Spacer(Modifier.height(10.dp))
                    Field(recoveryKey, { recoveryKey = it }, t("settings.account.recoveryKey"), mono = true)
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, t("settings.account.newPassword"), password = true, onSubmit = { recoverAccount() })
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(t("auth.authScreen.setANewPassword"), busy) { recoverAccount() }
                    TextButton(onClick = { mode = Mode.SIGN_IN }) { Text(t("auth.authScreen.backToSignIn"), color = colors.textMuted) }
                }

                Mode.REGISTER -> {
                    Field(username, { username = it }, t("settings.account.username"), hint = t("auth.authScreen.lettersNumbersDotsAndUnderscores"))
                    Spacer(Modifier.height(10.dp))
                    Field(displayName, { displayName = it }, t("register.displayName"))
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, t("chat.lockedChannel.password"), password = !showPassword, trailing = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Lucide.EyeOff else Lucide.Eye,
                                t("auth.authScreen.showPassword"), tint = colors.icon,
                            )
                        }
                    })
                    Spacer(Modifier.height(10.dp))
                    val wantsInvite = instance?.registration == "invite"
                    val wantsKey = instance?.needsKey == true
                    Field(
                        confirm, { confirm = it }, t("register.confirmPassword"), password = true,
                        onSubmit = if (wantsInvite || wantsKey) null else ({ createAccount() }),
                    )
                    if (wantsInvite) {
                        Spacer(Modifier.height(10.dp))
                        Field(inviteCode, { inviteCode = it }, t("auth.authScreen.inviteCode"), onSubmit = if (wantsKey) null else ({ createAccount() }))
                    }
                    if (wantsKey) {
                        Spacer(Modifier.height(10.dp))
                        Field(registrationKey, { registrationKey = it }, t("auth.authScreen.registrationKey"), onSubmit = { createAccount() })
                    }
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(t("auth.authScreen.createAccount"), busy) { createAccount() }
                    TextButton(onClick = { mode = Mode.SIGN_IN }) { Text(t("auth.authScreen.iAlreadyHaveAnAccount"), color = colors.textBrand) }
                }

                Mode.SIGN_IN -> {
                    Field(username, { username = it }, t("settings.account.username"))
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, t("chat.lockedChannel.password"), password = !showPassword, onSubmit = { signIn() }, trailing = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Lucide.EyeOff else Lucide.Eye,
                                t("auth.authScreen.showPassword"), tint = colors.icon,
                            )
                        }
                    })
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(t("login.signIn"), busy) { signIn() }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        TextButton(onClick = { mode = Mode.RECOVER }) { Text(t("auth.authScreen.forgotPassword"), color = colors.textMuted) }
                        if (instance?.registration != "closed") {
                            TextButton(onClick = { mode = Mode.REGISTER }) { Text(t("auth.authScreen.createAccount"), color = colors.textBrand) }
                        }
                    }
                }
            }

            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Text(error!!, color = colors.danger, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }

            if (mode == Mode.SIGN_IN || mode == Mode.REGISTER) {
                Spacer(Modifier.height(20.dp))
                if (!changingServer) {
                    Text(
                        Api.baseUrl.removePrefix("https://").removePrefix("http://"),
                        color = colors.textPlaceholder,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.clickable { serverUrl = Api.baseUrl; changingServer = true }.padding(8.dp),
                    )
                } else {
                    Field(serverUrl, { serverUrl = it }, t("auth.authScreen.serverAddress"), imeAction = ImeAction.Done)
                    Spacer(Modifier.height(8.dp))
                    Row {
                        TextButton(onClick = {
                            val next = serverUrl.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
                            Api.baseUrl = next
                            SecureStore.saveServerUrl(next)
                            changingServer = false
                            scope.launch { Session.loadInstance() }
                        }) { Text(t("auth.authScreen.useThisServer"), color = colors.textBrand) }
                        TextButton(onClick = { changingServer = false }) { Text(t("chat.editMessage.cancel"), color = colors.textMuted) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    password: Boolean = false,
    mono: Boolean = false,
    hint: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    /**
     * What the keyboard's own confirm key does.
     *
     * Without it the last field of every form was a dead end: the keyboard
     * covers the button that finishes the form, so signing in or creating an
     * account meant dismissing the keyboard or scrolling past it first, with
     * nothing on screen to say that either would work.
     */
    onSubmit: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
) {
    val colors = chatColors
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text(label) },
            singleLine = true,
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (password) KeyboardType.Password else keyboardType,
                imeAction = if (onSubmit != null) ImeAction.Done else imeAction,
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    keyboard?.hide()
                    onSubmit?.invoke()
                },
            ),
            trailingIcon = trailing,
            textStyle = if (mono) MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
            else MaterialTheme.typography.bodyMedium,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = colors.bgInput,
                unfocusedContainerColor = colors.bgInput,
                focusedTextColor = colors.text,
                unfocusedTextColor = colors.text,
                focusedIndicatorColor = colors.brand,
                unfocusedIndicatorColor = colors.border,
                focusedLabelColor = colors.textMuted,
                unfocusedLabelColor = colors.textMuted,
                cursorColor = colors.brand,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        if (hint != null) {
            Text(hint, color = colors.textMuted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
        }
    }
}

@Composable
private fun PrimaryButton(label: String, busy: Boolean, onClick: () -> Unit) {
    val colors = chatColors
    Button(
        onClick = onClick,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().height(48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = colors.onBrand, strokeWidth = 2.dp)
        else Text(label, fontWeight = FontWeight.SemiBold)
    }
}
