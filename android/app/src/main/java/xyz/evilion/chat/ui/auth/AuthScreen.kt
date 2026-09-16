package xyz.evilion.chat.ui.auth

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
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
                error = e.message ?: "Something went wrong."
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(colors.bgBase).systemBarsPadding().imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(colors.brand),
                contentAlignment = Alignment.Center,
            ) {
                Text("EC", color = colors.onBrand, fontWeight = FontWeight.Bold, fontSize = 24.sp)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                when (mode) {
                    Mode.SIGN_IN -> "Welcome back"
                    Mode.REGISTER -> "Create an account"
                    Mode.RECOVER -> "Get your account back"
                    Mode.MFA -> "One more step"
                    Mode.UNLOCK -> "Unlock this device"
                },
                style = MaterialTheme.typography.titleLarge,
                color = colors.textStrong,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                when (mode) {
                    Mode.SIGN_IN -> instance?.name?.ifEmpty { null } ?: "Evilion Chat"
                    Mode.REGISTER -> "Your password never leaves this device."
                    Mode.RECOVER -> "Your recovery key unwraps your account's keys."
                    Mode.MFA -> "Enter the code from your authenticator app."
                    Mode.UNLOCK -> "Your password unlocks the keys for this device."
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
                        label = if (useBackupCode) "Backup code" else "6-digit code",
                        keyboardType = if (useBackupCode) KeyboardType.Text else KeyboardType.NumberPassword,
                    )
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Continue", busy) {
                        run {
                            if (useBackupCode) Session.completeMfa(null, code.trim())
                            else Session.completeMfa(code.trim(), null)
                        }
                    }
                    TextButton(onClick = { useBackupCode = !useBackupCode; code = "" }) {
                        Text(if (useBackupCode) "Use your authenticator app" else "Use a backup code", color = colors.textBrand)
                    }
                    TextButton(onClick = { Session.cancelMfa(); mode = Mode.SIGN_IN }) {
                        Text("Back", color = colors.textMuted)
                    }
                }

                Mode.UNLOCK -> {
                    Field(
                        value = password,
                        onChange = { password = it },
                        label = "Password",
                        password = !showPassword,
                        trailing = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                    "Show password", tint = colors.icon,
                                )
                            }
                        },
                    )
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Unlock", busy) { run { Session.unlock(password) } }
                    TextButton(onClick = { run { Session.logout() } }) {
                        Text("Sign out instead", color = colors.textMuted)
                    }
                }

                Mode.RECOVER -> {
                    Field(username, { username = it }, "Username")
                    Spacer(Modifier.height(10.dp))
                    Field(recoveryKey, { recoveryKey = it }, "Recovery key", mono = true)
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, "New password", password = true)
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Set a new password", busy) {
                        run { Session.recover(username.trim(), recoveryKey.trim(), password) }
                    }
                    TextButton(onClick = { mode = Mode.SIGN_IN }) { Text("Back to sign in", color = colors.textMuted) }
                }

                Mode.REGISTER -> {
                    Field(username, { username = it }, "Username", hint = "Letters, numbers, dots and underscores")
                    Spacer(Modifier.height(10.dp))
                    Field(displayName, { displayName = it }, "Display name")
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, "Password", password = !showPassword, trailing = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                "Show password", tint = colors.icon,
                            )
                        }
                    })
                    Spacer(Modifier.height(10.dp))
                    Field(confirm, { confirm = it }, "Confirm password", password = true)
                    if (instance?.registration == "invite") {
                        Spacer(Modifier.height(10.dp))
                        Field(inviteCode, { inviteCode = it }, "Invite code")
                    }
                    if (instance?.needsKey == true) {
                        Spacer(Modifier.height(10.dp))
                        Field(registrationKey, { registrationKey = it }, "Registration key")
                    }
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Create account", busy) {
                        if (password != confirm) {
                            error = "Those passwords do not match."
                            return@PrimaryButton
                        }
                        if (password.length < 8) {
                            error = "Use at least 8 characters."
                            return@PrimaryButton
                        }
                        run {
                            Session.register(
                                username.trim(), displayName.trim().ifEmpty { username.trim() }, password,
                                inviteCode.trim().ifEmpty { null }, registrationKey.trim().ifEmpty { null },
                            )
                        }
                    }
                    TextButton(onClick = { mode = Mode.SIGN_IN }) { Text("I already have an account", color = colors.textBrand) }
                }

                Mode.SIGN_IN -> {
                    Field(username, { username = it }, "Username")
                    Spacer(Modifier.height(10.dp))
                    Field(password, { password = it }, "Password", password = !showPassword, imeAction = ImeAction.Done, trailing = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                "Show password", tint = colors.icon,
                            )
                        }
                    })
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Sign in", busy) {
                        run {
                            val outcome = Session.login(username.trim(), password)
                            if (outcome.mfaRequired) {
                                code = ""
                                mode = Mode.MFA
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        TextButton(onClick = { mode = Mode.RECOVER }) { Text("Forgot password", color = colors.textMuted) }
                        if (instance?.registration != "closed") {
                            TextButton(onClick = { mode = Mode.REGISTER }) { Text("Create account", color = colors.textBrand) }
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
                    Field(serverUrl, { serverUrl = it }, "Server address", imeAction = ImeAction.Done)
                    Spacer(Modifier.height(8.dp))
                    Row {
                        TextButton(onClick = {
                            val next = serverUrl.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
                            Api.baseUrl = next
                            SecureStore.saveServerUrl(next)
                            changingServer = false
                            scope.launch { Session.loadInstance() }
                        }) { Text("Use this server", color = colors.textBrand) }
                        TextButton(onClick = { changingServer = false }) { Text("Cancel", color = colors.textMuted) }
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
    trailing: @Composable (() -> Unit)? = null,
) {
    val colors = chatColors
    Column(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text(label) },
            singleLine = true,
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (password) KeyboardType.Password else keyboardType,
                imeAction = imeAction,
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
