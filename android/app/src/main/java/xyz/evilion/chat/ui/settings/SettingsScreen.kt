package xyz.evilion.chat.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.evilion.chat.BuildConfig
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.media.AttachmentStore
import xyz.evilion.chat.net.AuthApi
import xyz.evilion.chat.net.MfaStatus
import xyz.evilion.chat.net.Session as ApiSession
import xyz.evilion.chat.net.UsersApi
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.chat.formatSize
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.theme.chatColors

/** Everything about this account and this device. */
@Composable
fun SettingsScreen(startPage: String) {
    val colors = chatColors
    var page by remember { mutableStateOf(startPage) }
    val me by AppState.me.collectAsState()

    Column(Modifier.fillMaxSize().background(colors.bgBase)) {
        Row(
            Modifier.fillMaxWidth().background(colors.bgRaised).statusBarsPadding().height(52.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Lucide.ArrowLeft, "Back", tint = colors.icon,
                modifier = Modifier.size(24.dp).clickable {
                    if (page == "root") Nav.go(Route.Chat(null, null)) else page = "root"
                },
            )
            Spacer(Modifier.width(16.dp))
            Text(
                when (page) {
                    "root" -> "Settings"
                    "account" -> "My account"
                    "appearance" -> "Appearance"
                    "notifications" -> "Notifications"
                    "voice" -> "Voice & video"
                    "privacy" -> "Privacy"
                    "security" -> "Security"
                    "sessions" -> "Devices"
                    "admin" -> "Instance"
                    else -> "About"
                },
                color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
            )
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            when (page) {
                "root" -> {
                    Row(
                        Modifier.fillMaxWidth().clickable { page = "account" }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(me?.id ?: "0", me?.name ?: "?", me?.avatarId, 52.dp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(me?.name ?: "", color = colors.textStrong, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            Text("@${me?.username ?: ""}", color = colors.textMuted, fontSize = 13.sp)
                        }
                    }
                    SettingsRow(Lucide.User, "My account") { page = "account" }
                    SettingsRow(Lucide.Brush, "Appearance") { page = "appearance" }
                    SettingsRow(Lucide.Bell, "Notifications") { page = "notifications" }
                    SettingsRow(Lucide.Mic, "Voice & video") { page = "voice" }
                    SettingsRow(Lucide.ShieldAlert, "Privacy") { page = "privacy" }
                    SettingsRow(Lucide.ShieldCheck, "Security") { page = "security" }
                    SettingsRow(Lucide.MonitorSmartphone, "Devices") { page = "sessions" }
                    if (me?.flags?.and(1) == 1) SettingsRow(Lucide.Shield, "Instance") { page = "admin" }
                    SettingsRow(Lucide.Info, "About") { page = "about" }
                    SignOutRow()
                }
                "account" -> AccountPage()
                "appearance" -> AppearancePage()
                "notifications" -> NotificationsPage()
                "voice" -> VoicePage()
                "privacy" -> PrivacyPage()
                "security" -> SecurityPage()
                "sessions" -> SessionsPage()
                "admin" -> AdminPage()
                else -> AboutPage()
            }
        }
    }
}

@Composable
private fun SettingsRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = colors.icon, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, color = colors.text, fontSize = 15.sp)
    }
}

@Composable
private fun SignOutRow() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().clickable { scope.launch { Session.logout() } }.padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Lucide.LogOut, null, tint = colors.danger, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(16.dp))
        Text("Sign out", color = colors.danger, fontSize = 15.sp)
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val colors = chatColors
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        Text(title.uppercase(), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, lines: Int = 1) {
    val colors = chatColors
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = lines == 1,
        minLines = lines,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
            focusedTextColor = colors.text, unfocusedTextColor = colors.text,
            focusedLabelColor = colors.textMuted, unfocusedLabelColor = colors.textMuted,
            cursorColor = colors.brand,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Action(label: String, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) {
    val colors = chatColors
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (danger) colors.danger else colors.brand,
            contentColor = colors.onBrand,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(label) }
}

@Composable
private fun Toggle(label: String, description: String? = null, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, color = colors.text, fontSize = 15.sp)
            description?.let { Text(it, color = colors.textMuted, fontSize = 12.sp) }
        }
        Switch(checked = checked, onCheckedChange = onChange, colors = SwitchDefaults.colors(checkedThumbColor = colors.brand))
    }
}

@Composable
private fun AccountPage() {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by AppState.me.collectAsState()
    var displayName by remember(me?.id) { mutableStateOf(me?.displayName.orEmpty()) }
    var aboutMe by remember(me?.id) { mutableStateOf(me?.aboutMe.orEmpty()) }
    var pronouns by remember(me?.id) { mutableStateOf(me?.pronouns.orEmpty()) }
    var status by remember(me?.id) { mutableStateOf(me?.statusText.orEmpty()) }
    var saving by remember { mutableStateOf(false) }

    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching
                val type = context.contentResolver.getType(uri) ?: "image/png"
                UsersApi.uploadAvatar("avatar", bytes, type)
                AppState.me.value = UsersApi.me()
            }.onFailure { Session.toasts.emit(it.message ?: "That picture could not be uploaded.") }
        }
    }
    val pickBanner = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching
                val type = context.contentResolver.getType(uri) ?: "image/png"
                UsersApi.uploadAvatar("banner", bytes, type)
                AppState.me.value = UsersApi.me()
            }.onFailure { Session.toasts.emit(it.message ?: "That picture could not be uploaded.") }
        }
    }

    Section("Profile picture") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(me?.id ?: "0", me?.name ?: "?", me?.avatarId, 64.dp)
            Spacer(Modifier.width(16.dp))
            Column {
                Text(
                    "Change avatar", color = colors.textBrand, fontSize = 14.sp,
                    modifier = Modifier.clickable {
                        pickAvatar.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }.padding(vertical = 4.dp),
                )
                Text(
                    "Change banner", color = colors.textBrand, fontSize = 14.sp,
                    modifier = Modifier.clickable {
                        pickBanner.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }.padding(vertical = 4.dp),
                )
            }
        }
    }
    Section("About you") {
        Field(displayName, { displayName = it }, "Display name")
        Spacer(Modifier.height(8.dp))
        Field(pronouns, { pronouns = it }, "Pronouns")
        Spacer(Modifier.height(8.dp))
        Field(aboutMe, { aboutMe = it }, "About me", lines = 4)
        Spacer(Modifier.height(8.dp))
        Field(status, { status = it }, "Custom status")
        Spacer(Modifier.height(12.dp))
        Action("Save", enabled = !saving) {
            saving = true
            scope.launch {
                runCatching {
                    val updated = UsersApi.patchMe(buildJsonObject {
                        put("display_name", displayName)
                        put("about_me", aboutMe)
                        put("pronouns", pronouns)
                        put("status_text", status)
                    })
                    AppState.me.value = updated
                    Session.toasts.emit("Saved.")
                }.onFailure { Session.toasts.emit(it.message ?: "That did not save.") }
                saving = false
            }
        }
    }
    Section("Username") {
        Text("@${me?.username ?: ""}", color = colors.textSubtle, fontSize = 15.sp)
        Text("Your username is how people find you.", color = colors.textMuted, fontSize = 12.sp)
    }
}

@Composable
private fun AppearancePage() {
    val colors = chatColors
    val doc by SettingsStore.doc.collectAsState()
    Section("Theme") {
        for ((id, label) in listOf("dark" to "Dark", "light" to "Light", "ash" to "Ash", "onyx" to "Onyx", "system" to "Follow the system")) {
            Row(
                Modifier.fillMaxWidth().clickable { SettingsStore.put("theme", id) }.padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(18.dp).clip(RoundedCornerShape(9.dp))
                        .background(if (SettingsStore.theme == id) colors.brand else colors.bgSurface),
                )
                Spacer(Modifier.width(12.dp))
                Text(label, color = colors.text, fontSize = 15.sp)
            }
        }
    }
    Section("Messages") {
        Toggle("Compact mode", "Less space between messages.", SettingsStore.messageDisplay == "compact") {
            SettingsStore.put("messageDisplay", if (it) "compact" else "cozy")
        }
        Toggle("Show link previews", null, SettingsStore.linkPreviews) { SettingsStore.put("linkPreviews", it) }
        Toggle("Show images", null, SettingsStore.imagePreviews) { SettingsStore.put("imagePreviews", it) }
        Toggle("Reduce motion", null, SettingsStore.reducedMotion) { SettingsStore.put("reducedMotion", it) }
    }
}

@Composable
private fun NotificationsPage() {
    val doc by SettingsStore.doc.collectAsState()
    val muted = SettingsStore.mutedChannels
    Section("Notifications") {
        Toggle("Notifications on this device", "Messages while the app is closed.", SettingsStore.deviceBool("notifications", true)) {
            SettingsStore.setDeviceBool("notifications", it)
        }
        Toggle("Sounds", null, SettingsStore.soundsOn) { SettingsStore.putIn("notifications", "sounds", JsonPrimitive(it)) }
    }
    if (muted.isNotEmpty()) {
        Section("Muted conversations") {
            for (id in muted) {
                val channel = AppState.channels.value[id]
                Text(
                    channel?.let { AppState.channelName(it) } ?: id,
                    color = chatColors.textMuted, fontSize = 14.sp,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun VoicePage() {
    Section("Microphone") {
        Toggle("Push to talk", "Hold the button in a call instead of sending whenever you speak.", SettingsStore.deviceString("voiceMode", "vad") == "ptt") {
            SettingsStore.setDeviceString("voiceMode", if (it) "ptt" else "vad")
        }
        Toggle("Echo cancellation", null, SettingsStore.deviceBool("echoCancellation", true)) {
            SettingsStore.setDeviceBool("echoCancellation", it)
        }
        Toggle("Noise suppression", null, SettingsStore.deviceBool("noiseSuppression", true)) {
            SettingsStore.setDeviceBool("noiseSuppression", it)
        }
        Toggle("Automatic gain", null, SettingsStore.deviceBool("autoGain", true)) {
            SettingsStore.setDeviceBool("autoGain", it)
        }
    }
    Section("Video") {
        Toggle("Start calls with video off", null, SettingsStore.deviceBool("videoOffByDefault", true)) {
            SettingsStore.setDeviceBool("videoOffByDefault", it)
        }
    }
}

@Composable
private fun PrivacyPage() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val me by AppState.me.collectAsState()
    Section("Direct messages") {
        for ((id, label) in listOf("everyone" to "Anyone", "friends" to "Friends only", "nobody" to "Nobody")) {
            Row(
                Modifier.fillMaxWidth().clickable {
                    scope.launch {
                        runCatching {
                            AppState.me.value = UsersApi.patchMe(buildJsonObject { put("dm_privacy", id) })
                        }
                    }
                }.padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(18.dp).clip(RoundedCornerShape(9.dp))
                        .background(if (me?.dmPrivacy == id) colors.brand else colors.bgSurface),
                )
                Spacer(Modifier.width(12.dp))
                Text(label, color = colors.text, fontSize = 15.sp)
            }
        }
    }
    Section("Blocked") {
        val blocked = AppState.relationships.value.values.filter { it.type == "blocked" }
        if (blocked.isEmpty()) {
            Text("Nobody is blocked.", color = colors.textMuted, fontSize = 14.sp)
        } else {
            for (relationship in blocked) {
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(relationship.user.name, color = colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(
                        "Unblock", color = colors.textBrand, fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            scope.launch { runCatching { xyz.evilion.chat.net.RelationshipsApi.unblock(relationship.user.id) } }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SecurityPage() {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var status by remember { mutableStateOf<MfaStatus?>(null) }
    var setup by remember { mutableStateOf<xyz.evilion.chat.net.TotpSetup?>(null) }
    var password by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var backupCodes by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { runCatching { status = AuthApi.mfaStatus() } }

    Section("Password") {
        Field(password, { password = it }, "Current password")
        Spacer(Modifier.height(8.dp))
        Field(newPassword, { newPassword = it }, "New password")
        Spacer(Modifier.height(12.dp))
        Action("Change password", enabled = !busy && password.isNotEmpty() && newPassword.length >= 8) {
            busy = true
            scope.launch {
                runCatching { Session.changePassword(password, newPassword) }
                    .onSuccess { note = "Password changed."; password = ""; newPassword = "" }
                    .onFailure { note = it.message }
                busy = false
            }
        }
    }

    Section("Two-factor authentication") {
        Text(
            if (status?.enabled == true) "On. Sign-ins ask for a code." else "Off. Anyone with your password can sign in.",
            color = colors.textMuted, fontSize = 13.sp,
        )
        Spacer(Modifier.height(10.dp))
        if (status?.enabled == true) {
            Action("Turn off", danger = true, enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.mfaDisable(password) }
                        .onSuccess { status = AuthApi.mfaStatus(); note = "Two-factor is off." }
                        .onFailure { note = it.message }
                    busy = false
                }
            }
            Spacer(Modifier.height(8.dp))
            Action("New backup codes", enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.newBackupCodes(password) }
                        .onSuccess { backupCodes = it }
                        .onFailure { note = it.message }
                    busy = false
                }
            }
        } else if (setup == null) {
            Action("Set up with an authenticator app", enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.totpSetup(password) }
                        .onSuccess { setup = it }
                        .onFailure { note = it.message }
                    busy = false
                }
            }
            Text("Enter your password above first.", color = colors.textMuted, fontSize = 12.sp)
        } else {
            Text("Add this secret to your authenticator app:", color = colors.textSubtle, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Text(
                setup!!.formatted.ifEmpty { setup!!.secret },
                color = colors.textStrong, fontFamily = FontFamily.Monospace, fontSize = 15.sp,
                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(setup!!.secret)) },
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Open in your authenticator app",
                color = colors.textBrand, fontSize = 13.sp,
                modifier = Modifier.clickable {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(setup!!.uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                },
            )
            Spacer(Modifier.height(10.dp))
            Field(code, { code = it }, "6-digit code")
            Spacer(Modifier.height(10.dp))
            Action("Turn on", enabled = !busy && code.length >= 6) {
                busy = true
                scope.launch {
                    runCatching { AuthApi.totpEnable(setup!!.ticket, code.trim()) }
                        .onSuccess {
                            backupCodes = it.backupCodes
                            setup = null
                            code = ""
                            status = AuthApi.mfaStatus()
                            note = "Two-factor is on. Save these backup codes."
                        }
                        .onFailure { note = it.message }
                    busy = false
                }
            }
        }
        if (backupCodes.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(colors.bgInput).padding(12.dp)) {
                Text(
                    backupCodes.joinToString("\n"),
                    color = colors.textStrong, fontFamily = FontFamily.Monospace, fontSize = 13.sp,
                )
            }
            Text(
                "Copy these", color = colors.textBrand, fontSize = 13.sp,
                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(backupCodes.joinToString("\n"))) }.padding(top = 4.dp),
            )
        }
    }

    Section("Recovery key") {
        Text(
            "A recovery key is the only way back in if you forget your password.",
            color = colors.textMuted, fontSize = 13.sp,
        )
        Spacer(Modifier.height(8.dp))
        Action("Make a new recovery key", enabled = !busy && password.isNotEmpty()) {
            busy = true
            scope.launch {
                runCatching { Session.newRecoveryKey(password) }
                    .onSuccess { note = "Your new recovery key: $it" }
                    .onFailure { note = it.message }
                busy = false
            }
        }
    }

    note?.let {
        Section("") { Text(it, color = colors.textSubtle, fontSize = 13.sp) }
    }
}

@Composable
private fun SessionsPage() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<List<ApiSession>?>(null) }
    LaunchedEffect(Unit) { runCatching { sessions = AuthApi.sessions() } }

    Section("Where you are signed in") {
        when {
            sessions == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            sessions!!.isEmpty() -> Text("No other devices.", color = colors.textMuted, fontSize = 14.sp)
            else -> for (session in sessions!!) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            session.userAgent.take(60).ifEmpty { "Unknown device" },
                            color = colors.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            (if (session.current) "This device · " else "") + session.ip,
                            color = colors.textMuted, fontSize = 12.sp,
                        )
                    }
                    if (!session.current) {
                        Text(
                            "Sign out", color = colors.danger, fontSize = 13.sp,
                            modifier = Modifier.clickable {
                                scope.launch {
                                    runCatching { AuthApi.deleteSession(session.id) }
                                    sessions = runCatching { AuthApi.sessions() }.getOrNull()
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminPage() {
    val colors = chatColors
    var stats by remember { mutableStateOf<xyz.evilion.chat.net.AdminStats?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { stats = xyz.evilion.chat.net.AdminApi.stats() }.onFailure { error = "Only instance admins can see this." }
    }
    Section("This instance") {
        when {
            error != null -> Text(error!!, color = colors.textMuted, fontSize = 14.sp)
            stats == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            else -> Column {
                StatRow("Version", stats!!.version)
                StatRow("Accounts", stats!!.users.toString())
                StatRow("Servers", stats!!.servers.toString())
                StatRow("Messages", stats!!.messages.toString())
                StatRow("Online now", stats!!.online.toString())
                StatRow("Files", "${stats!!.blobs} (${formatSize(stats!!.blobBytes)})")
            }
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    val colors = chatColors
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, color = colors.textMuted, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = colors.text, fontSize = 14.sp)
    }
}

@Composable
private fun AboutPage() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var usage by remember { mutableStateOf(AttachmentStore.usage()) }
    val instance by AppState.instance.collectAsState()
    Section("Nexa for Android") {
        StatRow("App version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        StatRow("Server", xyz.evilion.chat.net.Api.baseUrl.removePrefix("https://"))
        StatRow("Server version", instance?.version ?: "—")
        StatRow("Cached files", formatSize(usage))
        Spacer(Modifier.height(12.dp))
        Action("Clear cached files") {
            AttachmentStore.clear()
            usage = AttachmentStore.usage()
        }
    }
    Section("End-to-end encryption") {
        Text(
            "Messages, files and calls are encrypted on this device. The server only ever holds ciphertext, " +
                "and your identity key is kept in this phone's hardware key store.",
            color = colors.textMuted, fontSize = 13.sp,
        )
    }
}
