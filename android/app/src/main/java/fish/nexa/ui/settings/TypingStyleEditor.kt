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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.TypingStyle
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.pickers.Pickers
import fish.nexa.ui.server.CropResult
import fish.nexa.ui.server.ServerApi
import fish.nexa.ui.server.openImageCrop
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Nothing chosen is the plain style, which is stored as none. */
private fun tidy(style: TypingStyle): TypingStyle? = if (style.emoji.isEmpty() && style.preset.isNullOrEmpty() && style.words.isNullOrEmpty()) null else style

/** A choice among a few, drawn as a small pill, the chosen one lit in the accent (TypingEditor.module.css .pill). */
@Composable
internal fun ChoicePill(text: String, on: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(999.dp)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .height(38.dp)
            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .background(if (on) mixSrgb(c.bgSurface, c.brand, 0.18f) else c.bgSurface, shape)
            .background(sheen(c), shape)
            .then(if (on) Modifier.ring(shape, c.brand.copy(alpha = 0.8f), 2.dp) else Modifier.ring(shape, if (pressed) c.borderStrong else c.borderSubtle))
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(interaction, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Txt(text, style = Nx.type.body.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(550)), color = if (on || pressed) c.textStrong else c.textSubtle, maxLines = 1)
    }
}

/** A label over a group of choices (`.label`). */
@Composable
internal fun GroupLabel(text: String) {
    Txt(text, style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700), letterSpacing = 0.01.em), color = Nx.colors.textMuted, modifier = Modifier.padding(bottom = 8.dp))
}

/** An emoji, a server's or pack's emoji, or a picture of one's own, as a typing style slot holds it. */
@Composable
private fun SlotGlyph(token: String) {
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val image = TypingStyle.image(token)
    val custom = TypingStyle.custom(token)
    when {
        image != null -> AsyncImage(Media.typingUrl(image, 30, density), null, Media.loader, Modifier.size(30.dp))
        custom != null -> AsyncImage(Media.emojiUrl(custom.id, 30, density), custom.name, Media.loader, Modifier.size(30.dp))
        else -> TwemojiImage(token, 28.dp)
    }
}

/**
 * Settings, Profiles: how "is typing…" looks for you to everyone else
 * (TypingStyleEditor.tsx; the designer shows the conversation itself, so this
 * has no preview of its own): up to three emoji or pictures of your own (the
 * first one picked fills all three, to start from a whole set), how they
 * move, and the words after your name.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TypingStyleEditor(value: TypingStyle?, onChange: (TypingStyle?) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // a picture is put up before it goes in, and the style may have changed meanwhile
    val latest by rememberUpdatedState(value)
    var uploading by remember { mutableStateOf<Int?>(null) }
    var pictureSlot by remember { mutableIntStateOf(0) }
    // "Your Own" chosen before anything is written in it
    var ownOpen by remember { mutableStateOf(!value?.words.isNullOrEmpty()) }
    val style = value ?: TypingStyle(emptyList(), "wave")
    val wordsMode = if (!style.words.isNullOrEmpty() || ownOpen) "own" else style.preset ?: ""

    fun change(next: TypingStyle) {
        val words = next.words?.takeIf { it.isNotEmpty() }
        onChange(tidy(next.copy(words = words, preset = if (words != null) null else next.preset?.takeIf { it.isNotEmpty() })))
    }
    fun pickEmoji(slot: Int, token: String) {
        val now = latest ?: TypingStyle(emptyList(), "wave")
        // the first emoji fills every slot, so there is a whole set to change from
        val emoji = if (now.emoji.isEmpty()) List(TypingStyle.MAX_EMOJI) { token }
        else now.emoji.mapIndexed { i, e -> if (i == slot) token else e } + (if (slot >= now.emoji.size) listOf(token) else emptyList())
        change(now.copy(emoji = emoji.take(TypingStyle.MAX_EMOJI)))
    }
    fun removeEmoji(slot: Int) = change(style.copy(emoji = style.emoji.filterIndexed { i, _ -> i != slot }))
    fun upload(slot: Int, r: CropResult) {
        uploading = slot
        scope.launch {
            try {
                val q = r.crop?.let { "?x=${it.x}&y=${it.y}&w=${it.w}&h=${it.h}" } ?: ""
                val res = ServerApi.upload("POST", "/users/@me/typing/image$q", r.bytes, r.type) as JsonObject
                val id = (res["id"] as? JsonPrimitive)?.contentOrNull ?: throw IllegalStateException()
                pickEmoji(slot, "img:$id")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("composer.composer.uploadFailed")), "error")
            } finally {
                uploading = null
            }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val slot = pictureSlot
        scope.launch {
            val f = runCatching { ServerApi.read(context, uri) }.getOrNull() ?: return@launch
            openImageCrop(f, 1f, round = false, title = t("widgets.card.cropTitle"), maxSize = 96, serverCrop = true) { upload(slot, it) }
        }
    }
    // a slot takes an emoji (one of the app's, or a server's or pack's) or a picture of one's own
    fun openSlot(i: Int) {
        val token = style.emoji.getOrNull(i)
        val slot = if (token != null) i else minOf(i, style.emoji.size)
        openMenu(buildList {
            add(MenuItem.Action(t("typing.editor.pickEmoji")) {
                Pickers.open(Pickers.Opener(listOf(Pickers.Tab.EMOJI), null, closeOnEmoji = true, onEmoji = { p -> pickEmoji(slot, p.text) }))
            })
            add(MenuItem.Action(t("typing.editor.usePicture")) {
                pictureSlot = slot
                pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            if (token != null) add(MenuItem.Action(t("typing.editor.removeItem"), danger = true) { removeEmoji(i) })
        })
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column {
            GroupLabel(t("typing.editor.emoji"))
            Txt(t("typing.editor.emojiHint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.textMuted, modifier = Modifier.padding(bottom = 10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (i in 0 until TypingStyle.MAX_EMOJI) {
                    val token = style.emoji.getOrNull(i)
                    val shape = RoundedCornerShape(10.dp)
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box {
                        Box(
                            Modifier
                                .size(52.dp)
                                .then(
                                    if (token == null) Modifier.border(1.5.dp, if (pressed) c.borderStrong else c.border, shape)
                                    else Modifier.background(c.bgSurface, shape).background(sheen(c), shape).ring(shape, if (pressed) c.borderStrong else c.borderSubtle).topEdge(shape, c.edgeLight),
                                )
                                .clip(shape)
                                .pressable(interaction, enabled = uploading == null) { openSlot(i) }
                                .semantics { contentDescription = if (token != null) t("typing.editor.changeEmoji", "n" to i + 1) else t("typing.editor.chooseEmoji", "n" to i + 1) },
                            contentAlignment = Alignment.Center,
                        ) {
                            when {
                                uploading == i -> Spinner(c.textMuted, size = 20.dp)
                                token != null -> SlotGlyph(token)
                                else -> Icon("Plus", c.textMuted, size = 20.dp)
                            }
                        }
                        if (token != null) Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .offset(x = 6.dp, y = (-6).dp)
                                .size(24.dp)
                                .ring(CircleShape, c.border)
                                .background(c.bgRaised, CircleShape)
                                .clip(CircleShape)
                                .pressable(remember { MutableInteractionSource() }) { removeEmoji(i) }
                                .semantics { contentDescription = t("typing.editor.removeEmoji", "n" to i + 1) },
                            contentAlignment = Alignment.Center,
                        ) { Icon("X", c.textMuted, size = 12.dp) }
                    }
                }
            }
        }

        Column {
            GroupLabel(t("typing.editor.motion"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                // how the emoji move means nothing until there are emoji
                for (m in TypingStyle.MOTIONS) ChoicePill(t("typing.motion.$m"), style.motion == m, enabled = style.emoji.isNotEmpty()) { change(style.copy(motion = m)) }
            }
        }

        Column {
            GroupLabel(t("typing.editor.words"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ChoicePill(TypingStyle.presetLabel(""), wordsMode == "") {
                    ownOpen = false
                    change(style.copy(preset = null, words = null))
                }
                for (p in TypingStyle.PRESETS) ChoicePill(TypingStyle.presetLabel(p), wordsMode == p) {
                    ownOpen = false
                    change(style.copy(preset = p, words = null))
                }
                ChoicePill(t("typing.editor.ownWords"), wordsMode == "own") { ownOpen = true }
            }
            if (wordsMode == "own") NxTextField(
                style.words ?: "",
                { v -> change(style.copy(words = v.replace(Regex("\\s+"), " ").trimStart().take(TypingStyle.MAX_WORDS), preset = null)) },
                Modifier.padding(top = 8.dp).widthIn(max = 360.dp),
                placeholder = t("typing.editor.ownPlaceholder"),
                capitalize = false,
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NxButton(t("typing.editor.surprise"), {
                ownOpen = false
                onChange(TypingStyle.surprise(value))
            }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Dices")
            if (value != null) NxButton(t("typing.editor.reset"), {
                ownOpen = false
                onChange(null)
            }, kind = ButtonKind.GHOST, size = ButtonSize.SM, icon = "RotateCcw")
        }
    }
}
