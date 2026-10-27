package fish.nexa.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.People
import fish.nexa.data.NameStyle
import fish.nexa.data.TypingStyle
import fish.nexa.media.Media
import fish.nexa.net.MeUser
import fish.nexa.net.WornTag
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.chat.ServerTagChip
import fish.nexa.ui.chat.StyledTyping
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.AvatarColor
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ServerIcon
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.TabStrip
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.components.sidewaysScroll
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.profile.FullProfileCard
import fish.nexa.ui.profile.ProfileDesign
import fish.nexa.ui.profile.ProfilePart
import fish.nexa.ui.profile.ProfilePopoutCard
import fish.nexa.ui.profile.ProfileTab
import fish.nexa.ui.profile.ProfileTheme
import fish.nexa.ui.profile.WidgetDesign
import fish.nexa.ui.profile.Widgets
import fish.nexa.ui.server.CropResult
import fish.nexa.ui.server.ServerApi
import fish.nexa.ui.server.canWearTag
import fish.nexa.ui.server.hexOf
import fish.nexa.ui.server.openImageCrop
import fish.nexa.ui.server.parseHex
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** The theme's preset colours (ProfilePage.tsx PRESETS). */
private val PRESETS = listOf(0x8000ffL, 0x5865f2L, 0x3d9e60L, 0xfdb833L, 0xda3e44L, 0xeb459fL, 0x1abc9cL, 0xe67e22L, 0x607d8bL)

/**
 * The profile designer's form: the words, colours, typing line and widgets
 * that wait for Save Changes. Pictures, the server tag worn and the status
 * change at once, as they always have.
 */
object ProfileForm {
    var forId by mutableStateOf<String?>(null)
    var displayName by mutableStateOf("")
    var pronouns by mutableStateOf("")
    /** As written: custom emoji as their :name: (AboutMe). The box's own state, so nothing copies it back and forth. */
    val aboutState = androidx.compose.foundation.text.input.TextFieldState()
    val about: String get() = aboutState.text.toString()
    var accent by mutableStateOf<Long?>(null)
    var accent2 by mutableStateOf<Long?>(null)
    var typing by mutableStateOf<TypingStyle?>(null)
    var nameLook by mutableStateOf<NameStyle?>(null)
    var widgets by mutableStateOf<List<Widgets.Widget>>(emptyList())
    /** The widgets as saved; null until they have come with the whole profile. */
    var savedWidgets by mutableStateOf<List<Widgets.Widget>?>(null)
    var widgetsFailed by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var uploading by mutableStateOf<String?>(null)

    private var aboutKey = ""
    private var aboutEdit = ""

    /** The saved About Me as it is written, worked out once per change. */
    fun loadedAbout(me: MeUser): String {
        if (me.aboutMe != aboutKey || aboutEdit.isEmpty() && me.aboutMe.isNotEmpty()) {
            aboutKey = me.aboutMe
            aboutEdit = AboutMe.toEdit(me.aboutMe)
        }
        return aboutEdit
    }

    fun take(me: MeUser) {
        displayName = me.displayName
        pronouns = me.pronouns
        aboutState.setTextAndPlaceCursorAtEnd(loadedAbout(me))
        accent = me.accentColor
        accent2 = me.accentColor2
        typing = TypingStyle.read(me.typingStyle)
        nameLook = NameStyle.read(me.nameStyle)
    }

    fun typingChanged(me: MeUser) = !TypingStyle.same(typing, TypingStyle.read(me.typingStyle))
    fun nameLookChanged(me: MeUser) = nameLook != NameStyle.read(me.nameStyle)
    fun profileChanged(me: MeUser) = displayName != me.displayName || pronouns != me.pronouns || about != loadedAbout(me) ||
        accent != me.accentColor || accent2 != me.accentColor2 || typingChanged(me) || nameLookChanged(me)
    fun widgetsChanged() = savedWidgets.let { it != null && it != widgets }
    fun dirty(me: MeUser) = profileChanged(me) || widgetsChanged()

    fun reset(me: MeUser) {
        take(me)
        savedWidgets?.let { widgets = it }
    }

    suspend fun loadWidgets(userId: String) {
        widgetsFailed = false
        try {
            val list = Widgets.read(People.profile(userId).widgets)
            widgets = list
            savedWidgets = list
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            widgetsFailed = true
        }
    }

    suspend fun save(me: MeUser) {
        saving = true
        try {
            if (profileChanged(me)) {
                val typingNow = typingChanged(me)
                val nameNow = nameLookChanged(me)
                val u = patchMe(buildJsonObject {
                    put("display_name", JsonPrimitive(displayName.trim()))
                    put("pronouns", JsonPrimitive(pronouns.trim()))
                    put("about_me", JsonPrimitive(AboutMe.toSave(about)))
                    put("accent_color", accent?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("accent_color_2", accent2?.let { JsonPrimitive(it) } ?: JsonNull)
                    if (typingNow) put("typing_style", typing?.toJson() ?: JsonNull)
                    if (nameNow) put("name_style", nameLook?.toJson() ?: JsonNull)
                })
                // the server trims and cleans what it stores, so its copy is taken back or the form stays "unsaved"
                take(u)
            }
            if (widgetsChanged()) {
                val res = Nexa.api.request("PUT", "/users/@me/widgets", buildJsonObject { put("widgets", JsonArray(widgets.map { Widgets.toJson(it) })) }) as JsonObject
                val list = Widgets.read((res["widgets"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList())
                widgets = list
                savedWidgets = list
            }
            Nexa.ui.toast(t("settings.profile.profileSaved"), "success")
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("settings.privacy.couldNotSave")), "error")
        } finally {
            saving = false
        }
    }

    /** Puts up a new picture (avatar or banner), cut on the server to the part framed; it changes at once. */
    suspend fun upload(kind: String, r: CropResult) {
        uploading = kind
        try {
            val area = r.crop?.let { "?x=${it.x}&y=${it.y}&w=${it.w}&h=${it.h}" } ?: ""
            val res = ServerApi.upload("PUT", "/users/@me/$kind$area", r.bytes, r.type) as JsonObject
            res["user"]?.let { Nexa.users.setMe(wireJson.decodeFromJsonElement(MeUser.serializer(), it)) }
            Nexa.ui.toast(if (kind == "avatar") t("settings.profile.avatarUpdated") else t("settings.profile.bannerUpdated"), "success")
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("composer.composer.uploadFailed")), "error")
        } finally {
            uploading = null
        }
    }

    suspend fun remove(kind: String) {
        try {
            Nexa.api.request("DELETE", "/users/@me/$kind")
            Nexa.users.setMe(Nexa.api.get("/users/@me", MeUser.serializer()))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("settings.profile.couldNotRemove")), "error")
        }
    }
}

/** Puts a server's tag on the account, or takes it off (null), saying how it went. */
private suspend fun wearServerTag(serverId: String?, text: String = ""): Boolean = try {
    val res = if (serverId != null) Nexa.api.request("PUT", "/users/@me/server-tag", buildJsonObject { put("server_id", JsonPrimitive(serverId)) })
    else Nexa.api.request("DELETE", "/users/@me/server-tag")
    Nexa.users.setMe(wireJson.decodeFromJsonElement(MeUser.serializer(), res))
    Nexa.ui.toast(if (serverId != null) t("serverTag.nowWearing", "tag" to text) else t("serverTag.tookOff"), "success")
    true
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    Nexa.ui.toast(describeError(e, t("serverTag.couldNotChange")), "error")
    false
}

/**
 * 3.2 Profiles (ProfilePage.tsx): the profile designer. What is edited is the
 * profile itself, as others see it: every part of it opens what changes it,
 * written in place or chosen in a sheet, and every empty part shows what it
 * could hold. Three views show it where people meet it (the full profile, the
 * card a name opens, and a conversation), and a strip of every part is the way
 * to each for anyone who would rather pick from a list.
 */
@Composable
fun ProfilesPage(anchor: String?) {
    // opened for one server ("server:<id>", its Edit Server Profile): that server's designer
    val serverAnchor = anchor?.takeIf { it.startsWith("server:") }?.removePrefix("server:")
    var scope by remember(anchor) { mutableStateOf(if (serverAnchor != null) "server" else "main") }
    var picked by remember(anchor) { mutableStateOf(serverAnchor) }
    androidx.compose.runtime.SideEffect { ProfileScope.scope = scope }
    PageTitle(t("settings.profile.profiles"))
    ScopeTabs(scope) { next -> Unsaved.unlessUnsaved { scope = next } }
    if (scope == "main") MainDesigner(anchor?.takeIf { serverAnchor == null })
    else ServerProfileDesigner(picked) { picked = it }
}

/** Main Profile and Server Profiles: which profile the designer below draws (`.scopeTabs`). */
@Composable
private fun ScopeTabs(scope: String, onScope: (String) -> Unit) {
    fish.nexa.ui.components.UnderlineTabs(
        listOf("main" to t("settings.profile.mainProfile"), "server" to t("settings.profile.serverProfiles")),
        scope, t("settings.profile.profiles"), Modifier.padding(bottom = 18.dp),
    ) { onScope(it) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MainDesigner(anchor: String?) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val meState by Nexa.users.me.collectAsState()
    val me = meState ?: return
    val f = ProfileForm
    LaunchedEffect(me.id) {
        if (f.forId != me.id) {
            f.take(me)
            f.forId = me.id
        }
        f.loadWidgets(me.id)
    }
    var view by remember { mutableStateOf(if (anchor == "typingStyle") "chat" else "full") }
    var inline by remember { mutableStateOf<ProfilePart?>(null) }
    var tab by remember { mutableStateOf<ProfileTab?>(null) }
    var tabNonce by remember { mutableIntStateOf(0) }
    // every part outlined once as the designer opens, to show what can be pressed
    var intro by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(1800)
        intro = false
    }
    fun showTab(next: ProfileTab) {
        tab = next
        tabNonce += 1
    }
    // asked for a part (Settings' search, a typing line's Make Your Own): show the view it is in
    LaunchedEffect(anchor) {
        when (anchor) {
            null -> Unit
            "typingStyle" -> view = "chat"
            "widgets" -> {
                view = "full"
                showTab(ProfileTab.WIDGETS)
            }
            else -> view = "full"
        }
    }

    var picking by remember { mutableStateOf("avatar") }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val kind = picking
        scope.launch {
            val file = runCatching { ServerApi.read(context, uri) }.getOrNull() ?: return@launch
            if (file.bytes.size > 10 * 1024 * 1024) {
                Nexa.ui.toast(t("settings.profile.imagesAreLimitedTo10Mb"), "error")
                return@launch
            }
            if (kind == "avatar") openImageCrop(file, 1f, round = true, title = t("settings.profile.cropYourAvatar"), maxSize = 1024, serverCrop = true) { r -> scope.launch { f.upload("avatar", r) } }
            else openImageCrop(file, 600f / 240f, round = false, title = t("settings.profile.cropYourBanner"), maxSize = 1920, serverCrop = true) { r -> scope.launch { f.upload("banner", r) } }
        }
    }
    fun choose(kind: String) {
        picking = kind
        pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    fun open(part: String) {
        when (part) {
            "name", "pronouns", "about" -> {
                if (view == "chat") view = "full"
                // a phone's one column keeps About Me behind its own tab
                if (part == "about" && view == "full") showTab(ProfileTab.ABOUT)
                inline = when (part) {
                    "name" -> ProfilePart.NAME
                    "pronouns" -> ProfilePart.PRONOUNS
                    else -> ProfilePart.ABOUT
                }
            }
            "status" -> fish.nexa.ui.dialogs.Dialogs.customStatus()
            "typing" -> view = "chat"
            "nameStyle" -> openNameStyleSheet({ Nexa.users.me.value }, { f.displayName.trim().ifEmpty { me.displayName } }, { f.nameLook }) { f.nameLook = it }
            "widgets" -> {
                view = "full"
                showTab(ProfileTab.WIDGETS)
            }
            "avatar" -> openAvatarSheet(::choose) { scope.launch { f.remove("avatar") } }
            "banner" -> openBannerSheet(::choose, onRemove = { scope.launch { f.remove("banner") } }, onColours = { openColoursSheet() })
            "colours" -> openColoursSheet()
            "tag" -> openTagSheet()
        }
    }

    val widgetTools = if (f.savedWidgets == null) null else WidgetDesign(
        edit = { id -> f.widgets.firstOrNull { it.id == id }?.let { w -> openWidgetEditor(w, isNew = false) { done -> f.widgets = f.widgets.map { if (it.id == done.id) done else it } } } },
        move = { id, delta ->
            val list = f.widgets.toMutableList()
            val at = list.indexOfFirst { it.id == id }
            val to = at + delta
            if (at >= 0 && to in list.indices) {
                list.add(to, list.removeAt(at))
                f.widgets = list
            }
        },
        remove = { id -> f.widgets = f.widgets.filter { it.id != id } },
        feature = { id -> f.widgets.firstOrNull { it.id == id }?.let { w -> f.widgets = listOf(w) + f.widgets.filter { it.id != id } } },
        add = {
            openAddWidget(f.widgets) { fresh ->
                openWidgetEditor(fresh, isNew = true) { done ->
                    f.widgets = f.widgets + done
                    if (view == "full") showTab(ProfileTab.WIDGETS)
                }
            }
        },
    )
    val nameStyle = Nx.type.name.copy(
        fontSize = Nx.type.sp(if (view == "card") 20f else 28f),
        lineHeight = Nx.type.sp(if (view == "card") 23f else 30.8f),
        fontWeight = FontWeight(700),
        letterSpacing = (-0.01).em,
    )
    val design = ProfileDesign(
        edit = { part ->
            when (part) {
                ProfilePart.BANNER -> open("banner")
                ProfilePart.AVATAR -> open("avatar")
                ProfilePart.STATUS -> open("status")
                ProfilePart.NAME -> open("name")
                ProfilePart.TAG -> open("tag")
                ProfilePart.PRONOUNS -> open("pronouns")
                ProfilePart.ABOUT -> open("about")
            }
        },
        name = if (inline == ProfilePart.NAME) ({
            InlineText(f.displayName, { f.displayName = it }, { inline = null }, 32, t("settings.account.displayName"), null, nameStyle)
        }) else null,
        pronouns = if (inline == ProfilePart.PRONOUNS) ({
            InlineText(f.pronouns, { f.pronouns = it }, { inline = null }, 40, t("settings.profile.pronouns"), t("settings.profile.addYourPronouns"), Nx.type.bodySmall.copy(fontSize = Nx.type.sp(if (view == "card") 13.5f else 15.5f)))
        }) else null,
        about = if (inline == ProfilePart.ABOUT) ({ InlineAbout { inline = null } }) else null,
        widgets = widgetTools,
        intro = intro,
    )
    val preview = me.asPublic().copy(
        displayName = f.displayName.trim().ifEmpty { me.displayName },
        pronouns = f.pronouns,
        aboutMe = AboutMe.toSave(f.about),
        accentColor = f.accent,
        accentColor2 = f.accent2,
        typingStyle = f.typing?.toJson(),
        nameStyle = f.nameLook?.toJson(),
    )
    // the stage glows in the profile's own colour, as the card does: its theme, or its banner's or picture's
    val theme = ProfileTheme.of(f.accent, f.accent2)
    val density = LocalDensity.current.density
    val tint = ProfileTheme.rememberDominant(if (theme != null) null else Media.bannerUrl(me.bannerId, 64, 1f) ?: Media.avatarUrl(me.avatarId, 64, 1f))
    val glow = theme?.top ?: tint ?: c.brand

    Txt(
        t("designer.introTouch"),
        style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21f)),
        color = c.textMuted,
        modifier = Modifier.padding(top = 0.dp, bottom = 18.dp).settingAnchor("profile"),
    )
    // every part of the profile, grouped by what it changes, each showing what it holds now (the web's panel)
    val shown = f.displayName.trim().ifEmpty { me.displayName }
    val ownLook = f.nameLook?.let { fish.nexa.ui.chat.RoleLook(color = null, own = it) }
    val status = listOf(me.statusEmoji, me.statusText).filter { it.isNotEmpty() }.joinToString(" ")
    val typingWords = TypingStyle.text(f.typing)
    val valueStyle = Nx.type.body.copy(fontSize = Nx.type.sp(14f))
    val groups = listOf(
        t("designer.group.name") to listOf(
            PartRow("name", t("settings.account.displayName"), null) { fish.nexa.ui.chat.RoleName(shown, ownLook, style = valueStyle, fallback = c.textMuted, maxLines = 1) },
            PartRow("nameStyle", t("nameStyle.title"), "nameStyle") {
                if (ownLook != null) fish.nexa.ui.chat.RoleName(shown, ownLook, valueStyle.copy(fontWeight = FontWeight(600)), c.textMuted)
                else Txt(t("designer.value.plain"), style = valueStyle, color = c.textMuted, maxLines = 1)
            },
            PartRow("pronouns", t("settings.profile.pronouns"), null, empty = f.pronouns.isBlank()) { Txt(f.pronouns, style = valueStyle, color = c.textMuted, maxLines = 1) },
        ),
        t("designer.group.look") to listOf(
            PartRow("avatar", t("settings.profile.avatar"), "avatar") { Avatar(me.id, me.displayName, me.avatarId, 28.dp) },
            PartRow("banner", t("settings.profile.profileBanner"), "banner") {
                val url = Media.bannerUrl(me.bannerId, 128, density)
                Box(
                    Modifier.size(56.dp, 24.dp).clip(RoundedCornerShape(6.dp)).background(
                        when {
                            url != null -> Brush.verticalGradient(listOf(c.bgSurface, c.bgSurface))
                            theme != null -> Brush.verticalGradient(listOf(theme.top, theme.bottom))
                            else -> Brush.verticalGradient(listOf(f.accent?.let { rgbColor(it) } ?: fish.nexa.ui.components.AvatarColor.of(me.id), f.accent?.let { rgbColor(it) } ?: fish.nexa.ui.components.AvatarColor.of(me.id)))
                        },
                    ),
                ) { if (url != null) AsyncImage(url, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            },
            PartRow("colours", t("settings.profile.profileTheme"), "profileTheme", empty = f.accent == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (col in listOfNotNull(f.accent, f.accent2)) Box(Modifier.size(18.dp).clip(RoundedCornerShape(6.dp)).background(rgbColor(col)))
                }
            },
        ),
        t("designer.group.about") to listOf(
            PartRow("about", t("settings.profile.aboutMe"), null, empty = f.about.isBlank()) { Txt(f.about.trim().lineSequence().first(), style = valueStyle, color = c.textMuted, maxLines = 1) },
            PartRow("status", t("designer.part.status"), null, empty = status.isEmpty()) { Txt(status, style = valueStyle, color = c.textMuted, maxLines = 1) },
            PartRow("widgets", t("widgets.title"), "widgets", empty = f.widgets.isEmpty()) { Txt(f.widgets.size.toString(), style = valueStyle, color = c.textMuted, maxLines = 1) },
            PartRow("tag", t("serverTag.choose.title"), "serverTag", empty = me.serverTag == null) { Txt(me.serverTag?.text ?: "", style = valueStyle, color = c.textMuted, maxLines = 1) },
            PartRow("typing", t("typing.editor.title"), "typingStyle", empty = typingWords.isEmpty()) { Txt(typingWords, style = valueStyle, color = c.textMuted, maxLines = 1) },
        ),
    )
    Column(Modifier.padding(bottom = 16.dp).semantics { contentDescription = t("designer.parts") }, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for ((title, rows) in groups) PartGroup(title, rows) { open(it) }
    }
    TabStrip(
        listOf("full" to t("designer.view.full"), "card" to t("designer.view.card"), "chat" to t("designer.view.chat")),
        view, t("designer.view.label"), tabHeight = 32.dp,
    ) { view = it }
    Spacer(Modifier.height(14.dp))

    if (f.widgetsFailed) Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp)
            .ring(Radii.Md, c.borderSubtle)
            .clip(Radii.Md)
            .background(c.bgSurface)
            .background(sheen(c))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Txt(t("widgets.couldNotLoad"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, modifier = Modifier.weight(1f))
        NxButton(t("invite.tryAgain"), { scope.launch { f.loadWidgets(me.id) } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
    }

    Stage(glow) {
        when (view) {
            "full" -> FullProfileCard(
                preview, tab, null, close = {}, design = design, previewWidgets = f.widgets, embedded = true, tabNonce = tabNonce,
            )
            "card" -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Box(
                    Modifier
                        .widthIn(max = 320.dp)
                        .fillMaxWidth()
                        .align(Alignment.CenterHorizontally)
                        .shadowMedium(Radii.Lg, c)
                        .ring(Radii.Lg, c.panelEdge)
                        .clip(Radii.Lg),
                ) { ProfilePopoutCard(preview, null, close = {}, design = design, previewWidgets = f.widgets) }
                CardAside(widgetTools)
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                ChatPreview(me, preview.displayName, f.typing, look = fish.nexa.ui.chat.RoleLooks.withOwn(null, f.nameLook?.toJson()))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .ring(Radii.Lg, c.borderSubtle)
                        .clip(Radii.Lg)
                        .background(c.bgSurface)
                        .background(sheen(c))
                        .topEdge(Radii.Lg, c.edgeLight)
                        .padding(18.dp),
                ) {
                    Txt(t("typing.editor.title"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.padding(bottom = 4.dp).semantics { heading() })
                    Txt(t("typing.editor.hint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19.6f)), color = c.textMuted, modifier = Modifier.padding(bottom = 14.dp))
                    TypingStyleEditor(f.typing) { f.typing = it }
                }
            }
        }
    }
    Txt(t("designer.caption.$view"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.textMuted, modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp))
    if (f.uploading != null) Row(Modifier.padding(start = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Spinner(c.textMuted, size = 14.dp)
        Txt(t("common.working"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
    }
}

/** Lets a row run edge to edge of the page, past its side padding. */
internal fun Modifier.bleed(side: androidx.compose.ui.unit.Dp): Modifier = layout { m, cs ->
    val extra = (side * 2).roundToPx()
    val w = cs.maxWidth + extra
    val p = m.measure(cs.copy(minWidth = w, maxWidth = w))
    layout(cs.maxWidth, p.height) { p.place(-extra / 2, 0) }
}

/** A part of the profile in the list: its name, what it holds now (or Add), and the way to change it. */
internal class PartRow(val part: String, val label: String, val setting: String?, val empty: Boolean = false, val value: @Composable () -> Unit)

/** One group of the list (the web's `.group`): a quiet heading over raised rows joined into one panel. */
@Composable
internal fun PartGroup(title: String, rows: List<PartRow>, onOpen: (String) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(title, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(650)), color = c.textMuted, modifier = Modifier.padding(horizontal = 4.dp).semantics { heading() })
        Column(
            Modifier
                .fillMaxWidth()
                .shadowLow(Radii.Md, c)
                .background(c.bgSurface, Radii.Md)
                .background(sheen(c), Radii.Md)
                .ring(Radii.Md, c.borderSubtle)
                .topEdge(Radii.Md, c.edgeLight)
                .clip(Radii.Md),
        ) {
            rows.forEachIndexed { i, row ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 50.dp)
                        .settingAnchor(row.setting)
                        .pressable(remember { MutableInteractionSource() }, role = Role.Button) { onOpen(row.part) }
                        .padding(start = 14.dp, end = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Txt(row.label, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.textSubtle, maxLines = 1)
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                        if (row.empty) Txt(t("designer.value.add"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textBrand, maxLines = 1)
                        else row.value()
                    }
                    Icon("ChevronRight", c.textMuted, size = 16.dp)
                }
            }
        }
    }
}

/** The stage: the profile as others see it, lit in its own colour; that glow is the one bold thing on the page. */
@Composable
internal fun Stage(glow: Color, content: @Composable () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Lg
    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .drawBehind {
                drawRect(mixOklab(c.bgBase, c.bgRaised, 0.28f))
                // radial-gradient(75% 65% at 50% -12%): the glow from above
                val cx = size.width / 2f
                val cy = -size.height * 0.12f
                val rx = size.width * 0.75f
                val ry = size.height * 0.65f
                scale(1f, ry / rx, Offset(cx, cy)) {
                    drawCircle(Brush.radialGradient(0f to glow.copy(alpha = if (c.isLight) 0.2f else 0.3f), 0.72f to Color.Transparent, center = Offset(cx, cy), radius = rx), rx, Offset(cx, cy))
                }
                // radial-gradient(45% 40% at 92% 108%): a little of it back from the far corner
                val bx = size.width * 0.92f
                val by = size.height * 1.08f
                val brx = size.width * 0.45f
                val bry = size.height * 0.4f
                scale(1f, bry / brx, Offset(bx, by)) {
                    drawCircle(Brush.radialGradient(0f to glow.copy(alpha = if (c.isLight) 0.1f else 0.14f), 0.7f to Color.Transparent, center = Offset(bx, by), radius = brx), brx, Offset(bx, by))
                }
            }
            .ring(shape, c.borderSubtle)
            .padding(10.dp),
    ) { content() }
}

/** A word of the profile written where it is shown: Done keeps it; leaving the box keeps it too. */
@Composable
internal fun InlineText(value: String, onChange: (String) -> Unit, onDone: () -> Unit, max: Int, label: String, placeholder: String?, style: TextStyle) {
    val c = Nx.colors
    val p = fish.nexa.ui.profile.LocalProfile.current
    val accent = if (p.accent != Color.Unspecified) p.accent else c.brand
    val requester = remember { FocusRequester() }
    var field by remember { mutableStateOf(TextFieldValue(value, TextRange(0, value.length))) }
    var had by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { requester.requestFocus() }
    val shape = RoundedCornerShape(8.dp)
    BasicTextField(
        field,
        { v ->
            val next = v.copy(text = v.text.take(max))
            field = next
            onChange(next.text)
        },
        Modifier
            .widthIn(min = 120.dp)
            .keptAboveSaveBar(field.text, had)
            .focusRequester(requester)
            .onFocusChanged {
                if (it.isFocused) had = true
                else if (had) onDone()
            }
            .background(c.bgInput.copy(alpha = 0.78f), shape)
            .drawBehind { drawRect(accent, Offset(0f, size.height - 2.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx())) }
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .semantics { contentDescription = label },
        textStyle = style.copy(color = c.textStrong),
        singleLine = true,
        cursorBrush = SolidColor(accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        decorationBox = { inner ->
            Box {
                if (field.text.isEmpty() && placeholder != null) Txt(placeholder, style = style, color = c.textPlaceholder, maxLines = 1)
                inner()
            }
        },
    )
}

/** About Me written where it is shown, ready to type into as it opens. */
@Composable
internal fun InlineAbout(state: androidx.compose.foundation.text.input.TextFieldState = ProfileForm.aboutState, onDone: () -> Unit) {
    val c = Nx.colors
    val about = state.text.toString()
    // the box with its count and Done kept in view while it is written in, above the save bar
    Column(Modifier.keptAboveSaveBar(about, true), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AboutMeEditor(state, AboutMe.MAX, t("settings.profile.tellPeopleAboutYourself"), t("settings.profile.aboutMe"), focus = true)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Txt(t("composer.limit.left", "count" to AboutMe.MAX - AboutMe.toSave(about).length), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
            NxButton(t("pick.done"), onDone, size = ButtonSize.SM)
        }
    }
}

/** The card view's side: which widget the card shows, which is the first one on the full profile. */
@Composable
internal fun CardAside(tools: WidgetDesign?, widgets: List<Widgets.Widget> = ProfileForm.widgets) {
    val c = Nx.colors
    Column(
        Modifier
            .fillMaxWidth()
            .ring(Radii.Md, c.borderSubtle)
            .clip(Radii.Md)
            .background(c.bgSurface)
            .background(sheen(c))
            .topEdge(Radii.Md, c.edgeLight)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon("Pin", c.textBrand, size = 15.dp)
            Txt(t("designer.card.title"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.semantics { heading() })
        }
        Txt(t("designer.card.hint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
        val first = widgets.firstOrNull()
        if (widgets.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (w in widgets) {
                val on = first?.id == w.id
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (on) c.brand.copy(alpha = 0.14f) else if (pressed) c.bgHover else Color.Transparent)
                        .pressable(interaction, role = Role.RadioButton) { tools?.feature?.invoke(w.id) }
                        .semantics { selected = on }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        Modifier
                            .size(16.dp)
                            .then(if (on) Modifier.background(c.brand, CircleShape) else Modifier)
                            .border(2.dp, if (on) c.brand else c.borderStrong, CircleShape)
                            .padding(4.dp)
                            .then(if (on) Modifier.background(c.bgSurface, CircleShape) else Modifier),
                    )
                    Txt(Widgets.name(w), style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.text, maxLines = 1)
                }
            }
        } else {
            Txt(t("designer.card.none"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
            NxButton(t("widgets.addOne"), { tools?.add?.invoke() }, size = ButtonSize.SM, icon = "Plus", enabled = tools != null, block = true)
        }
    }
}

/** A conversation as others see it: their message, then yours with your name and tag, then you typing. */
@Composable
internal fun ChatPreview(
    me: MeUser,
    name: String,
    typing: TypingStyle?,
    avatarId: String? = me.avatarId,
    channel: String = "general",
    /** Your name in a server's roles' colours, as that server draws it. */
    look: fish.nexa.ui.chat.RoleLook? = null,
) {
    val c = Nx.colors
    // two messages from a few minutes ago, in the reader's own way of writing times
    val whenAt = remember { System.currentTimeMillis() - 4 * 60 * 1000L }
    val friend = t("designer.chat.friend")
    Column(
        Modifier
            .fillMaxWidth()
            .shadowMedium(Radii.Lg, c)
            .ring(Radii.Lg, c.panelEdge)
            .clip(Radii.Lg)
            .background(c.bgRaised)
            .topEdge(Radii.Lg, c.edgeLight),
    ) {
        Box(
            Modifier.fillMaxWidth().height(48.dp).drawBehind { drawRect(c.borderSubtle, Offset(0f, size.height - 1.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }.padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Txt("#$channel", style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(16f), fontWeight = FontWeight(700)), color = c.textStrong) }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            PreviewMessage("designer-friend", friend, null, null, Time.timestamp(whenAt - 60 * 1000L), t("designer.chat.theirs"))
            PreviewMessage(me.id, name, avatarId, me.serverTag, Time.timestamp(whenAt), t("designer.chat.yours"), look)
        }
        Box(Modifier.fillMaxWidth().heightIn(min = 30.dp).padding(start = 16.dp, end = 16.dp, top = 4.dp), contentAlignment = Alignment.CenterStart) {
            StyledTyping(typing, name)
        }
        Box(
            Modifier
                .padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 16.dp)
                .fillMaxWidth()
                .height(44.dp)
                .background(c.bgInput, Radii.Md)
                .ring(Radii.Md, c.borderSubtle)
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Txt(t("typing.editor.composer"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textPlaceholder, maxLines = 1) }
    }
}

@Composable
private fun PreviewMessage(id: String, name: String, avatarId: String?, tag: WornTag?, time: String, text: String, look: fish.nexa.ui.chat.RoleLook? = null) {
    val c = Nx.colors
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Avatar(id, name, avatarId, 40.dp)
        Column(Modifier.weight(1f)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                fish.nexa.ui.chat.RoleName(name, look, Nx.type.body.copy(fontWeight = FontWeight(650)), c.textStrong)
                look?.icon?.let { fish.nexa.ui.chat.RoleIcon(it, 18.dp) }
                if (tag != null) ServerTagChip(tag, small = false)
                Txt(time, style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
            }
            Txt(text, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), lineHeight = Nx.type.sp(21.3f)), color = c.text, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

/** A hint inside a sheet (`.popHint`). */
@Composable
internal fun PopHint(text: String) = Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.9f)), color = Nx.colors.textMuted)

/** Avatar: the picture, Change Avatar and Remove Avatar. */
private fun openAvatarSheet(choose: (String) -> Unit, onRemove: () -> Unit) {
    openSheet("designer-avatar", title = t("settings.profile.avatar")) { close ->
        val me by Nexa.users.me.collectAsState()
        val m = me ?: return@openSheet
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(m.id, m.displayName, m.avatarId, 64.dp)
                FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxButton(t("settings.profile.changeAvatar"), { choose("avatar") }, size = ButtonSize.SM, icon = "ImagePlus", loading = ProfileForm.uploading == "avatar")
                    if (m.avatarId != null) NxButton(t("settings.profile.removeAvatar"), {
                        close()
                        onRemove()
                    }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
                }
            }
            PopHint(t("designer.imageHint"))
        }
    }
}

/** Profile Banner: the picture (or what shows without one), Change or Add, Remove, and the colours instead. */
private fun openBannerSheet(choose: (String) -> Unit, onRemove: () -> Unit, onColours: () -> Unit) {
    openSheet("designer-banner", title = t("settings.profile.profileBanner")) { close ->
        val c = Nx.colors
        val me by Nexa.users.me.collectAsState()
        val m = me ?: return@openSheet
        val f = ProfileForm
        val theme = ProfileTheme.of(f.accent, f.accent2)
        val density = LocalDensity.current.density
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val url = Media.bannerUrl(m.bannerId, 340, density)
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(5f / 2f)
                    .clip(Radii.Md)
                    .background(
                        when {
                            url != null -> Brush.verticalGradient(listOf(c.bgSurface, c.bgSurface))
                            theme != null -> Brush.verticalGradient(listOf(theme.top, theme.bottom))
                            else -> Brush.verticalGradient(listOf(f.accent?.let { rgbColor(it) } ?: fish.nexa.ui.components.AvatarColor.of(me?.id ?: ""), f.accent?.let { rgbColor(it) } ?: fish.nexa.ui.components.AvatarColor.of(me?.id ?: "")))
                        },
                    )
                    .ring(Radii.Md, c.borderSubtle),
            ) { if (url != null) AsyncImage(url, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NxButton(if (m.bannerId != null) t("settings.profile.changeBanner") else t("designer.addBanner"), { choose("banner") }, size = ButtonSize.SM, icon = "ImagePlus", loading = f.uploading == "banner")
                if (m.bannerId != null) NxButton(t("composer.composer.remove"), {
                    close()
                    onRemove()
                }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
            }
            PopHint(t("designer.imageHint"))
            if (m.bannerId == null) Row(
                Modifier.clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) {
                    close()
                    onColours()
                }.padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon("Palette", c.textBrand, size = 14.dp)
                Txt(t("designer.bannerColour"), style = Nx.type.body.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(650)), color = c.textBrand)
            }
        }
    }
}

/** Profile Theme: the top colour on its own colours the banner; both make the whole card a gradient. */
private fun openColoursSheet() {
    openSheet("designer-colours", title = t("settings.profile.profileTheme")) {
        val f = ProfileForm
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PopHint(t("settings.profile.topColourOnItsOwnIt"))
            ColourRow(f.accent, enabled = true, noneLabel = t("server.roles.default"), hexLabel = t("settings.profile.primaryColourHex"), fallback = 0x8000ffL, onNone = {
                f.accent = null
                f.accent2 = null
            }) { f.accent = it }
            PopHint(t("settings.profile.bottomColourPickOneTooAnd"))
            ColourRow(f.accent2, enabled = f.accent != null, noneLabel = t("settings.profile.none"), hexLabel = t("settings.profile.secondColourHex"), fallback = 0xeb459eL, onNone = { f.accent2 = null }) { f.accent2 = it }
        }
    }
}

/** One of the theme's two colours: none, the presets, one of your own, and its code. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ColourRow(value: Long?, enabled: Boolean, noneLabel: String, hexLabel: String, fallback: Long, onNone: () -> Unit, onPick: (Long) -> Unit) {
    val c = Nx.colors
    // the second colour waits for the first
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.graphicsLayer { alpha = if (enabled) 1f else 0.45f }) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Swatch(c.bgActive, value == null, noneLabel, { if (enabled) onNone() }, size = 38.dp)
            PRESETS.forEachIndexed { i, col ->
                Swatch(rgbColor(col), value == col, t("server.roles.colourIndexOfCount", "index" to i + 1, "count" to PRESETS.size), { if (enabled) onPick(col) }, size = 38.dp)
            }
            val custom = value != null && value !in PRESETS
            Swatch(if (custom) rgbColor(value!!) else c.bgSurface, custom, t("settings.appearance.custom"), {
                if (enabled) openColourPicker(t("settings.appearance.custom"), hexOf(value ?: fallback), alpha = false) { hex -> parseHex(hex)?.let(onPick) }
            }, size = 38.dp) { if (!custom) Icon("Pipette", c.icon, size = 16.dp) }
        }
        HexField(value, fallback, hexLabel, enabled, onPick)
    }
}

/** A hex field for people who know the colour they want (`#rgb` or `#rrggbb`), kept when it is a colour. */
@Composable
private fun HexField(value: Long?, fallback: Long, label: String, enabled: Boolean, onPick: (Long) -> Unit) {
    var draft by remember(value) { mutableStateOf(value?.let { hexOf(it) } ?: "") }
    NxTextField(
        draft,
        { v ->
            draft = v.take(7)
            // a whole code is used as it is typed; a short one (#rgb) when it is done
            if (draft.trim().removePrefix("#").length == 6) parseHex(draft)?.let(onPick)
        },
        // the label is said, not shown, as the web's aria-label
        Modifier.widthIn(max = 160.dp).semantics { contentDescription = label },
        placeholder = hexOf(fallback),
        enabled = enabled,
        mono = true,
        imeAction = ImeAction.Done,
        onIme = { parseHex(draft)?.let(onPick) },
    )
}

/** Server Tag: the tags of your servers to wear, and Take It Off. */
private fun openTagSheet() {
    openSheet("designer-tag", title = t("serverTag.choose.title")) { close ->
        val scope = rememberCoroutineScope()
        val me by Nexa.users.me.collectAsState()
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PopHint(t("serverTag.choose.hint"))
            ServerTagList { close() }
            if (me?.serverTag != null) NxButton(t("serverTag.takeOff"), {
                close()
                scope.launch { wearServerTag(null) }
            }, kind = ButtonKind.GHOST, size = ButtonSize.SM)
        }
    }
}

/** The servers with a tag this account could wear, each with its tag and the way to put it on (or that it is on). */
@Composable
private fun ServerTagList(onWorn: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val me by Nexa.users.me.collectAsState()
    val servers by Nexa.servers.byId.collectAsState()
    val order by Nexa.servers.order.collectAsState()
    var busy by remember { mutableStateOf<String?>(null) }
    val worn = me?.serverTag
    val tagged = order.mapNotNull { servers[it] }.filter { it.server.tag != null }
    if (tagged.isEmpty()) {
        PopHint(t("serverTag.choose.noneToWear"))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (st in tagged) {
            val tag = st.server.tag ?: continue
            val can = canWearTag(st)
            val wearing = worn?.serverId == st.server.id
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ServerIcon(st.server.id, st.server.name, st.server.iconId, 36.dp, radius = 10.dp)
                Column(Modifier.weight(1f)) {
                    Txt(st.server.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                    if (!can) Txt(t("serverTag.keptToRoles"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
                }
                ServerTagChip(WornTag(st.server.id, tag.text, tag.badge, tag.color), small = false)
                if (wearing) Txt(t("serverTag.choose.wearing"), style = Nx.type.label.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textMuted, maxLines = 1, modifier = Modifier.padding(horizontal = 8.dp))
                else NxButton(t("serverTag.wear"), {
                    busy = st.server.id
                    scope.launch {
                        val ok = wearServerTag(st.server.id, tag.text)
                        busy = null
                        if (ok) onWorn()
                    }
                }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, enabled = can, loading = busy == st.server.id)
            }
        }
    }
}

/** The designer's save bar: words, colours, widgets and the typing line wait for it. */
@Composable
fun BoxScope.ProfilesSaveBar() {
    if (ProfileScope.scope == "server") {
        ServerProfileSaveBar()
        return
    }
    val meState by Nexa.users.me.collectAsState()
    val me = meState ?: return
    val scope = rememberCoroutineScope()
    val f = ProfileForm
    SaveBar(
        dirty = f.forId == me.id && f.dirty(me),
        saving = f.saving,
        onReset = { f.reset(me) },
        onSave = { scope.launch { f.save(me) } },
        saveLabel = t("settings.profile.saveChanges"),
    )
}
