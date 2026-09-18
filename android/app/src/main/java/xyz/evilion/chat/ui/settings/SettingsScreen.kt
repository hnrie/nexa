package xyz.evilion.chat.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.LinearProgressIndicator
import xyz.evilion.chat.data.AppUpdate
import xyz.evilion.chat.i18n.LANGUAGES
import xyz.evilion.chat.data.readable
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.detached
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
                Lucide.ArrowLeft, t("modals.createServer.back"), tint = colors.icon,
                modifier = Modifier.size(24.dp).clickable {
                    if (page == "root") Nav.go(Route.Chat(null, null)) else page = "root"
                },
            )
            Spacer(Modifier.width(16.dp))
            Text(
                when (page) {
                    "root" -> t("main.sidebar.settings")
                    "account" -> t("settings.settingsScreen.myAccount")
                    "appearance" -> t("settings.appearance.appearance")
                    "notifications" -> t("settings.notifications.notifications")
                    "voice" -> t("settings.settingsScreen.voiceVideo")
                    "privacy" -> t("settings.settingsScreen.privacy")
                    "security" -> t("settings.security.security")
                    "sessions" -> t("settings.devices.devices")
                    "admin" -> t("settings.settings.instance")
                    else -> t("settings.settingsScreen.about")
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
                    SettingsRow(Lucide.User, t("settings.settingsScreen.myAccount")) { page = "account" }
                    SettingsRow(Lucide.Brush, t("settings.appearance.appearance")) { page = "appearance" }
                    SettingsRow(Lucide.Bell, t("settings.notifications.notifications")) { page = "notifications" }
                    SettingsRow(Lucide.Mic, t("settings.settingsScreen.voiceVideo")) { page = "voice" }
                    SettingsRow(Lucide.ShieldAlert, t("settings.settingsScreen.privacy")) { page = "privacy" }
                    SettingsRow(Lucide.ShieldCheck, t("settings.security.security")) { page = "security" }
                    SettingsRow(Lucide.MonitorSmartphone, t("settings.devices.devices")) { page = "sessions" }
                    if (me?.flags?.and(1) == 1) SettingsRow(Lucide.Shield, t("settings.settings.instance")) { page = "admin" }
                    SettingsRow(Lucide.Info, t("settings.settingsScreen.about")) { page = "about" }
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
        Text(t("settings.settingsScreen.signOut"), color = colors.danger, fontSize = 15.sp)
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
            }.onFailure { Session.toasts.emit(it.message ?: t("settings.settingsScreen.thatPictureCouldNotBeUploaded")) }
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
            }.onFailure { Session.toasts.emit(it.message ?: t("settings.settingsScreen.thatPictureCouldNotBeUploaded")) }
        }
    }

    Section(t("settings.settingsScreen.profilePicture")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(me?.id ?: "0", me?.name ?: "?", me?.avatarId, 64.dp)
            Spacer(Modifier.width(16.dp))
            Column {
                Text(
                    t("settings.settingsScreen.changeAvatar"), color = colors.textBrand, fontSize = 14.sp,
                    modifier = Modifier.clickable {
                        pickAvatar.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }.padding(vertical = 4.dp),
                )
                Text(
                    t("settings.settingsScreen.changeBanner"), color = colors.textBrand, fontSize = 14.sp,
                    modifier = Modifier.clickable {
                        pickBanner.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }.padding(vertical = 4.dp),
                )
            }
        }
    }
    Section(t("settings.settingsScreen.aboutYou")) {
        Field(displayName, { displayName = it }, t("register.displayName"))
        Spacer(Modifier.height(8.dp))
        Field(pronouns, { pronouns = it }, t("settings.profile.pronouns"))
        Spacer(Modifier.height(8.dp))
        Field(aboutMe, { aboutMe = it }, t("settings.settingsScreen.aboutMe"), lines = 4)
        Spacer(Modifier.height(8.dp))
        Field(status, { status = it }, t("settings.settingsScreen.customStatus"))
        Spacer(Modifier.height(12.dp))
        Action(t("chat.editMessage.save"), enabled = !saving) {
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
                    Session.toasts.emit(t("settings.account.saved"))
                }.onFailure { Session.toasts.emit(it.message ?: t("server.serverSettingsScreen.thatDidNotSave")) }
                saving = false
            }
        }
    }
    Section(t("settings.account.username")) {
        Text("@${me?.username ?: ""}", color = colors.textSubtle, fontSize = 15.sp)
        Text(t("settings.settingsScreen.yourUsernameIsHowPeopleFind"), color = colors.textMuted, fontSize = 12.sp)
    }
}

@Composable
private fun AppearancePage() {
    val colors = chatColors
    val doc by SettingsStore.doc.collectAsState()
    Section(t("settings.appearance.theme")) {
        for ((id, label) in listOf("dark" to t("settings.appearance.themeDark"), "light" to t("settings.appearance.themeLight"), "ash" to t("settings.appearance.themeAsh"), "onyx" to t("settings.appearance.themeOnyx"), "system" to t("settings.settingsScreen.followTheSystem"))) {
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
    Section(t("settings.appearance.language")) {
        Text(
            t("settings.appearance.languageHint"),
            color = colors.textMuted,
            fontSize = 13.sp,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        // null follows the phone, which is what someone who has never chosen expects
        for ((tag, label) in listOf<Pair<String?, String>>(null to t("settings.appearance.matchMyPhone")) +
            LANGUAGES.map { it.tag as String? to it.endonym }) {
            Row(
                Modifier.fillMaxWidth().clickable { if (tag == null) SettingsStore.put("locale", "") else SettingsStore.put("locale", tag) }
                    .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(18.dp).clip(RoundedCornerShape(9.dp))
                        .background(if (SettingsStore.locale == tag) colors.brand else colors.bgSurface),
                )
                Spacer(Modifier.width(12.dp))
                Text(label, color = colors.text, fontSize = 15.sp)
                LANGUAGES.firstOrNull { it.tag == tag }?.let {
                    Spacer(Modifier.width(8.dp))
                    Text(it.english, color = colors.textMuted, fontSize = 13.sp)
                }
            }
        }
    }
    Section(t("modals.quickSwitcher.messages")) {
        Toggle(t("settings.settingsScreen.compactMode"), t("settings.settingsScreen.lessSpaceBetweenMessages"), SettingsStore.messageDisplay == "compact") {
            SettingsStore.put("messageDisplay", if (it) "compact" else "cozy")
        }
        Toggle(t("settings.settingsScreen.showLinkPreviews"), null, SettingsStore.linkPreviews) { SettingsStore.put("linkPreviews", it) }
        Toggle(t("settings.settingsScreen.showImages"), null, SettingsStore.imagePreviews) { SettingsStore.put("imagePreviews", it) }
        Toggle(t("settings.settingsScreen.reduceMotion"), null, SettingsStore.reducedMotion) { SettingsStore.put("reducedMotion", it) }
    }
}

@Composable
private fun NotificationsPage() {
    val doc by SettingsStore.doc.collectAsState()
    val muted = SettingsStore.mutedChannels
    Section(t("settings.notifications.notifications")) {
        Toggle(t("settings.settingsScreen.notificationsOnThisDevice"), t("settings.settingsScreen.messagesWhileTheAppIsClosed"), SettingsStore.deviceBool("notifications", true)) {
            SettingsStore.setDeviceBool("notifications", it)
        }
        Toggle(t("settings.notifications.sounds"), null, SettingsStore.soundsOn) { SettingsStore.putIn("notifications", "sounds", JsonPrimitive(it)) }
    }
    if (muted.isNotEmpty()) {
        Section(t("settings.settingsScreen.mutedConversations")) {
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
    Section(t("settings.voice.microphone")) {
        Toggle(t("settings.settingsScreen.pushToTalk"), t("settings.settingsScreen.holdTheButtonInACall"), SettingsStore.deviceString("voiceMode", "vad") == "ptt") {
            SettingsStore.setDeviceString("voiceMode", if (it) "ptt" else "vad")
        }
        Toggle(t("settings.voice.echoCancellation"), null, SettingsStore.deviceBool("echoCancellation", true)) {
            SettingsStore.setDeviceBool("echoCancellation", it)
        }
        Toggle(t("settings.voice.noiseSuppression"), null, SettingsStore.deviceBool("noiseSuppression", true)) {
            SettingsStore.setDeviceBool("noiseSuppression", it)
        }
        Toggle(t("settings.settingsScreen.automaticGain"), null, SettingsStore.deviceBool("autoGain", true)) {
            SettingsStore.setDeviceBool("autoGain", it)
        }
    }
    Section(t("perms.video")) {
        Toggle(t("settings.settingsScreen.startCallsWithVideoOff"), null, SettingsStore.deviceBool("videoOffByDefault", true)) {
            SettingsStore.setDeviceBool("videoOffByDefault", it)
        }
    }
}

@Composable
private fun PrivacyPage() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val me by AppState.me.collectAsState()
    Section(t("settings.privacy.directMessages")) {
        for ((id, label) in listOf("everyone" to t("settings.settingsScreen.anyone"), "friends" to t("settings.privacy.friendsOnly"), "nobody" to t("settings.privacy.nobody"))) {
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
    Section(t("friends.blocked")) {
        val blocked = AppState.relationships.value.values.filter { it.type == "blocked" }
        if (blocked.isEmpty()) {
            Text(t("settings.settingsScreen.nobodyIsBlocked"), color = colors.textMuted, fontSize = 14.sp)
        } else {
            for (relationship in blocked) {
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(relationship.user.name, color = colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(
                        t("friends.unblock"), color = colors.textBrand, fontSize = 13.sp,
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

    Section(t("chat.lockedChannel.password")) {
        Field(password, { password = it }, t("settings.account.currentPassword"))
        Spacer(Modifier.height(8.dp))
        Field(newPassword, { newPassword = it }, t("settings.account.newPassword"))
        Spacer(Modifier.height(12.dp))
        Action(t("settings.settingsScreen.changePassword"), enabled = !busy && password.isNotEmpty() && newPassword.length >= 8) {
            busy = true
            scope.launch {
                runCatching { Session.changePassword(password, newPassword) }
                    .onSuccess { note = t("settings.settingsScreen.passwordChanged"); password = ""; newPassword = "" }
                    .onFailure { note = it.readable("SettingsScreen") }
                busy = false
            }
        }
    }

    Section(t("settings.security.twoFactorAuthentication")) {
        Text(
            if (status?.enabled == true) t("settings.settingsScreen.onSignInsAskForA") else t("settings.settingsScreen.offAnyoneWithYourPasswordCan"),
            color = colors.textMuted, fontSize = 13.sp,
        )
        Spacer(Modifier.height(10.dp))
        if (status?.enabled == true) {
            Action(t("settings.security.turnOff"), danger = true, enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.mfaDisable(password) }
                        .onSuccess { status = AuthApi.mfaStatus(); note = t("settings.settingsScreen.twoFactorIsOff") }
                        .onFailure { note = it.readable("SettingsScreen") }
                    busy = false
                }
            }
            Spacer(Modifier.height(8.dp))
            Action(t("settings.settingsScreen.newBackupCodes"), enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.newBackupCodes(password) }
                        .onSuccess { backupCodes = it }
                        .onFailure { note = it.readable("SettingsScreen") }
                    busy = false
                }
            }
        } else if (setup == null) {
            Action(t("settings.settingsScreen.setUpWithAnAuthenticatorApp"), enabled = !busy && password.isNotEmpty()) {
                busy = true
                scope.launch {
                    runCatching { Session.totpSetup(password) }
                        .onSuccess { setup = it }
                        .onFailure { note = it.readable("SettingsScreen") }
                    busy = false
                }
            }
            Text(t("settings.settingsScreen.enterYourPasswordAboveFirst"), color = colors.textMuted, fontSize = 12.sp)
        } else {
            Text(t("settings.settingsScreen.addThisSecretToYourAuthenticator"), color = colors.textSubtle, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Text(
                setup!!.formatted.ifEmpty { setup!!.secret },
                color = colors.textStrong, fontFamily = FontFamily.Monospace, fontSize = 15.sp,
                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(setup!!.secret)) },
            )
            Spacer(Modifier.height(6.dp))
            Text(
                t("settings.settingsScreen.openInYourAuthenticatorApp"),
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
            Action(t("settings.security.turnOn"), enabled = !busy && code.length >= 6) {
                busy = true
                scope.launch {
                    runCatching { AuthApi.totpEnable(setup!!.ticket, code.trim()) }
                        .onSuccess {
                            backupCodes = it.backupCodes
                            setup = null
                            code = ""
                            status = AuthApi.mfaStatus()
                            note = t("settings.settingsScreen.twoFactorIsOnSaveThese")
                        }
                        .onFailure { note = it.readable("SettingsScreen") }
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
                t("settings.settingsScreen.copyThese"), color = colors.textBrand, fontSize = 13.sp,
                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(backupCodes.joinToString("\n"))) }.padding(top = 4.dp),
            )
        }
    }

    Section(t("settings.account.recoveryKey")) {
        Text(
            t("settings.settingsScreen.aRecoveryKeyIsTheOnly"),
            color = colors.textMuted, fontSize = 13.sp,
        )
        Spacer(Modifier.height(8.dp))
        Action(t("settings.settingsScreen.makeANewRecoveryKey"), enabled = !busy && password.isNotEmpty()) {
            busy = true
            scope.launch {
                runCatching { Session.newRecoveryKey(password) }
                    .onSuccess { note = t("settings.settingsScreen.yourNewRecoveryKey", "key" to it) }
                    .onFailure { note = it.readable("SettingsScreen") }
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

    Section(t("settings.settingsScreen.whereYouAreSignedIn")) {
        when {
            sessions == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            sessions!!.isEmpty() -> Text(t("settings.settingsScreen.noOtherDevices"), color = colors.textMuted, fontSize = 14.sp)
            else -> for (session in sessions!!) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            session.userAgent.take(60).ifEmpty { t("settings.devices.unknownDevice") },
                            color = colors.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            (if (session.current) t("settings.settingsScreen.thisDevice") else "") + session.ip,
                            color = colors.textMuted, fontSize = 12.sp,
                        )
                    }
                    if (!session.current) {
                        Text(
                            t("settings.settingsScreen.signOut"), color = colors.danger, fontSize = 13.sp,
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
        runCatching { stats = xyz.evilion.chat.net.AdminApi.stats() }.onFailure { error = t("settings.settingsScreen.onlyInstanceAdminsCanSeeThis") }
    }
    Section(t("settings.settingsScreen.thisInstance")) {
        when {
            error != null -> Text(error!!, color = colors.textMuted, fontSize = 14.sp)
            stats == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            else -> Column {
                StatRow(t("settings.admin.version"), stats!!.version)
                StatRow(t("settings.settingsScreen.accounts"), stats!!.users.toString())
                StatRow(t("rail.rail.servers"), stats!!.servers.toString())
                StatRow(t("modals.quickSwitcher.messages"), stats!!.messages.toString())
                StatRow(t("settings.settingsScreen.onlineNow"), stats!!.online.toString())
                StatRow(t("settings.settingsScreen.files"), "${stats!!.blobs} (${formatSize(stats!!.blobBytes)})")
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
    Section(t("download.nexaForAndroid")) {
        StatRow(t("settings.settingsScreen.appVersion"), "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        StatRow(t("settings.settingsScreen.server"), xyz.evilion.chat.net.Api.baseUrl.removePrefix("https://"))
        StatRow(t("settings.settingsScreen.serverVersion"), instance?.version ?: "—")
        StatRow(t("settings.settingsScreen.cachedFiles"), formatSize(usage))
        Spacer(Modifier.height(12.dp))
        Action(t("settings.settingsScreen.clearCachedFiles")) {
            AttachmentStore.clear()
            usage = AttachmentStore.usage()
        }
    }
    UpdateSection()
    Section(t("settings.settingsScreen.endToEndEncryption")) {
        Text(
            t("settings.settingsScreen.messagesFilesAndCallsAreEncrypted"),
            color = colors.textMuted, fontSize = 13.sp,
        )
    }
}

/**
 * Updates, for an app that came from a website rather than a store.
 *
 * The state machine is [AppUpdate]'s; this only draws it. The one piece of
 * judgement here is the order of the last two steps: Android will not let this
 * app install anything until the person has said so on a system screen, and
 * asking for that *after* a 16 MB download, with the file sitting there and
 * nothing happening, is how a sideloaded updater earns its reputation. So the
 * permission is asked for first, with the reason on screen.
 */
@Composable
private fun UpdateSection() {
    val colors = chatColors
    val context = LocalContext.current
    val state by AppUpdate.state.collectAsState()

    Section(t("appUpdate.updates")) {
        when (val now = state) {
            is AppUpdate.State.Available -> {
                StatRow(t("appUpdate.newVersion"), "${now.release.version} · ${formatSize(now.build.size)}")
                now.release.notes?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = colors.textMuted, fontSize = 13.sp)
                }
                Spacer(Modifier.height(12.dp))
                Action(t("appUpdate.downloadVersion", "version" to now.release.version)) {
                    if (!AppUpdate.mayInstall(context)) AppUpdate.askToInstall(context)
                    else detached { AppUpdate.download(context, now.release, now.build) }
                }
                if (!AppUpdate.mayInstall(context)) {
                    Spacer(Modifier.height(8.dp))
                    Text(t("appUpdate.androidAsksOncePerApp"), color = colors.textMuted, fontSize = 12.sp)
                }
            }
            is AppUpdate.State.Downloading -> {
                val total = now.build.size.coerceAtLeast(1)
                StatRow(t("appUpdate.downloading"), "${formatSize(now.done)} / ${formatSize(now.build.size)}")
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (now.done.toFloat() / total).coerceIn(0f, 1f) },
                    color = colors.brand,
                    trackColor = colors.bgSurface,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            is AppUpdate.State.Ready -> {
                StatRow(t("appUpdate.ready"), now.release.version)
                Spacer(Modifier.height(12.dp))
                Action(t("appUpdate.install")) { AppUpdate.install(context, now.file) }
            }
            is AppUpdate.State.Failed -> {
                Text(now.why, color = colors.danger, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                Action(t("appUpdate.checkAgain")) { detached { AppUpdate.check(loud = true) } }
            }
            AppUpdate.State.Checking -> Text(t("appUpdate.checking"), color = colors.textMuted, fontSize = 13.sp)
            AppUpdate.State.UpToDate -> {
                Text(t("appUpdate.thisIsTheNewestBuild"), color = colors.textMuted, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                Action(t("appUpdate.checkAgain")) { detached { AppUpdate.check(loud = true) } }
            }
            AppUpdate.State.Idle -> Action(t("appUpdate.checkForUpdates")) { detached { AppUpdate.check(loud = true) } }
        }
    }
}
