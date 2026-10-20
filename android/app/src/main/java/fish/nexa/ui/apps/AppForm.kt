package fish.nexa.ui.apps

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Apps
import fish.nexa.data.Interactions
import fish.nexa.data.Pickables
import fish.nexa.net.AppForm
import fish.nexa.net.FormField
import fish.nexa.net.FormPart
import fish.nexa.net.InteractRequest
import fish.nexa.net.InteractionFile
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxCheckbox
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.markdown.Webhook
import fish.nexa.ui.media.HookEmojiGlyph
import fish.nexa.ui.media.HookTags
import fish.nexa.ui.server.ServerApi
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// field types, at the protocol's numbers
private const val F_TEXT = 4
private const val F_STRING_SELECT = 3
private const val F_FILES = 19
private const val F_RADIO = 21
private const val F_CHECKBOXES = 22
private const val F_CHECKBOX = 23

/** What has been filled into one field. */
private data class Answer(val value: String = "", val values: List<String> = emptyList(), val checked: Boolean = false, val files: List<InteractionFile> = emptyList())

private fun initialAnswer(f: FormField): Answer = when (f.type) {
    F_TEXT -> Answer(value = f.value ?: "")
    F_RADIO -> Answer(value = f.options?.firstOrNull { it.default }?.value ?: "")
    F_CHECKBOX -> Answer(checked = f.default == true)
    F_FILES -> Answer()
    F_STRING_SELECT, F_CHECKBOXES -> Answer(values = f.options.orEmpty().filter { it.default }.map { it.value })
    else -> Answer(values = f.defaultValues.orEmpty().map { it.id })
}

/** What is wrong with a field's answer, in words, or null. */
private fun problem(f: FormField, a: Answer): String? {
    fun count(n: Int, defMin: Int, defMax: Int): String? {
        val min = f.minValues ?: defMin
        val max = f.maxValues ?: defMax
        if (n == 0 && !f.required) return null
        if (n < min || n > max) return if (min == max) t("apps.form.pickExactly", "count" to min) else t("apps.form.pickBetween", "min" to min, "max" to max)
        return null
    }
    return when (f.type) {
        F_TEXT -> {
            val n = a.value.trim().codePointCount(0, a.value.trim().length)
            when {
                n == 0 -> if (f.required) t("apps.form.required") else null
                n < (f.minLength ?: 0) -> t("apps.form.tooShort", "count" to (f.minLength ?: 0))
                n > (f.maxLength ?: 4000) -> t("apps.form.tooLong", "count" to (f.maxLength ?: 4000))
                else -> null
            }
        }
        F_RADIO -> if (f.required && a.value.isEmpty()) t("apps.form.pickOne") else null
        F_CHECKBOX -> null
        F_FILES -> count(a.files.size, 1, 1)
        F_CHECKBOXES -> count(a.values.size, if (f.required) 1 else 0, f.options?.size ?: 0)
        else -> count(a.values.size, 1, 1)
    }
}

/** Opens the forms apps open, from wherever an interaction brings one. */
fun installAppForms() {
    Interactions.formOpener = { form, at -> openAppForm(form, at) }
}

/**
 * A form an app opened (web components/apps/AppFormModal.tsx), for someone to
 * fill in and send back to it. It says which app asks, and that what is sent
 * is not end-to-end encrypted, since the app reads it as it is. Each field is
 * drawn as the app asked: a line or a box of text, a list to pick from,
 * choices to tick, files.
 */
fun openAppForm(form: AppForm, at: Interactions.FormAt) {
    val fields = form.components.mapNotNull { p -> p.component?.let { p to it } }
    val answers = mutableStateMapOf<String, Answer>().apply { for ((_, f) in fields) put(f.customId, initialAnswer(f)) }
    val shown = mutableStateMapOf<String, String?>()
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    val appName = Interactions.appName(at.appId)

    suspend fun submit(close: () -> Unit) {
        if (busy) return
        for ((_, f) in fields) shown[f.customId] = problem(f, answers[f.customId] ?: Answer())
        if (shown.values.any { it != null }) return
        busy = true
        error = null
        val out = JsonArray(fields.map { (_, f) ->
            val a = answers[f.customId] ?: Answer()
            buildJsonObject {
                put("custom_id", f.customId)
                when (f.type) {
                    F_TEXT, F_RADIO -> put("value", a.value)
                    F_CHECKBOX -> put("checked", a.checked)
                    F_FILES -> put("values", JsonArray(a.files.map { JsonPrimitive(it.id) }))
                    else -> put("values", JsonArray(a.values.map { JsonPrimitive(it) }))
                }
            }
        })
        val res = Interactions.interact(
            InteractRequest(5, at.appId, at.channelId, modalOf = at.interactionId, data = buildJsonObject {
                put("custom_id", form.customId)
                put("fields", out)
            }),
            quiet = true,
        )
        busy = false
        if (res is Interactions.Outcome.Ok) close() else error = (res as Interactions.Outcome.Failed).error
    }

    openSheet(
        "app-form",
        title = form.title,
        over = {
            val c = Nx.colors
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Avatar(at.appId, appName, Nexa.users.get(at.appId)?.avatarId, 20.dp)
                Txt(appName, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textSubtle, maxLines = 1)
                HookTags({ openProfile(at.appId) }, app = true)
            }
        },
        footer = { close ->
            val scope = rememberCoroutineScope()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NxButton(t("apps.cancel"), { close() }, kind = ButtonKind.SECONDARY)
                NxButton(t("apps.form.submit"), { scope.launch { submit(close) } }, loading = busy)
            }
        },
    ) {
        val c = Nx.colors
        for (p in form.components) {
            val f = p.component
            if (f != null) FieldView(p, f, at.channelId, answers[f.customId] ?: Answer(), shown[f.customId]) {
                answers[f.customId] = it
                if (shown[f.customId] != null) shown[f.customId] = null
            } else p.content?.let { fish.nexa.ui.markdown.MarkdownView(it, fish.nexa.ui.markdown.RenderCtx(color = c.text, bodyPx = 15f, bodyLine = 21f)) }
        }
        error?.let { Txt(it, style = Nx.type.bodySmall, color = c.textDanger) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("LockOpen", c.textMuted, size = 14.dp, modifier = Modifier.padding(top = 2.dp))
            Txt(t("apps.form.notEncrypted", "app" to appName), style = Nx.type.hint.copy(lineHeight = Nx.type.sp(17f)), color = c.textMuted)
        }
    }
}

/** A field's label, with the mark of a required one, and its hint and problem under what it holds. */
@Composable
private fun Labeled(label: String, required: Boolean, hint: String?, error: String?, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (label.isNotEmpty()) BasicText(
            buildAnnotatedString {
                append(label)
                if (required) withStyle(SpanStyle(color = c.textDanger)) { append(" *") }
            },
            style = Nx.type.label.copy(color = if (error != null) c.textDanger else c.textSubtle),
        )
        content()
        if (error != null) Txt(error, style = Nx.type.hint, color = c.textDanger)
        else if (hint != null) Txt(hint, style = Nx.type.hint, color = c.textMuted)
    }
}

@Composable
private fun FieldView(part: FormPart, f: FormField, channelId: String, answer: Answer, error: String?, onAnswer: (Answer) -> Unit) {
    val label = part.label ?: ""
    val hint = part.description?.takeIf { it.isNotEmpty() }
    when (f.type) {
        F_TEXT -> Labeled(label, f.required, hint, error) {
            NxTextField(
                answer.value, { v -> onAnswer(answer.copy(value = v.take(f.maxLength ?: 4000))) },
                placeholder = f.placeholder,
                singleLine = f.style != 2,
                minLines = if (f.style == 2) 4 else 1,
                autoCorrect = true,
                capitalize = true,
                error = if (error != null) "" else null,
            )
        }
        F_CHECKBOX -> Column {
            NxCheckbox(answer.checked, { onAnswer(answer.copy(checked = it)) }, label)
            if (hint != null) Txt(hint, style = Nx.type.hint, color = Nx.colors.textMuted, modifier = Modifier.padding(start = 34.dp))
        }
        F_RADIO, F_CHECKBOXES -> {
            val radio = f.type == F_RADIO
            val picked = if (radio) listOfNotNull(answer.value.takeIf { it.isNotEmpty() }) else answer.values
            Labeled(label, f.required, hint, error) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (o in f.options.orEmpty()) {
                        val on = o.value in picked
                        ChoiceLine(on, radio, o.label, o.description, o.emoji?.let { Webhook.Emoji(it.id, it.name, it.animated) }) {
                            if (radio) onAnswer(answer.copy(value = o.value))
                            else onAnswer(answer.copy(values = if (on) picked - o.value else picked + o.value))
                        }
                    }
                }
            }
        }
        F_FILES -> Labeled(label, f.required, hint, error) { FileField(f, answer.files) { onAnswer(answer.copy(files = it)) } }
        else -> {
            val kind = entityKindOfComponent(f.type)
            val options = f.options.orEmpty()
            val min = f.minValues ?: if (f.required) 1 else 0
            val max = maxOf(1, f.maxValues ?: 1)
            Labeled(label, f.required, hint, error) {
                SelectBox(
                    placeholder = f.placeholder?.takeIf { it.isNotEmpty() } ?: t("apps.select.placeholder"),
                    // the field's own name, in the app's words
                    title = label.ifEmpty { f.placeholder?.takeIf { it.isNotEmpty() } ?: t("apps.select.title") },
                    picked = answer.values,
                    labelOf = { v -> if (kind != null) Pickables.label(channelId, v) else options.firstOrNull { it.value == v }?.label ?: v },
                    choicesFor = { q ->
                        if (kind != null) entityChoices(kind, channelId, q, f.channelTypes)
                        else options.filter { q.isEmpty() || it.label.lowercase().contains(q.lowercase()) }
                            .map { Choice(it.value, it.label, it.description, it.emoji?.let { e -> Webhook.Emoji(e.id, e.name, e.animated) }) }
                    },
                    min = minOf(min, max),
                    max = max,
                    searchable = kind != null || options.size > 8,
                    onSearch = if (kind != null) { q -> Pickables.findMembers(channelId, q) } else null,
                    invalid = error != null,
                    onCommit = { onAnswer(answer.copy(values = it)) },
                )
            }
        }
    }
}

/** One of a form's choices to tick: a radio dot or a tick box, its emoji, its words. */
@Composable
private fun ChoiceLine(on: Boolean, radio: Boolean, label: String, description: String?, emoji: Webhook.Emoji?, onClick: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(Radii.Sm)
            .background(if (on) c.bgSelected else c.bgSurface, Radii.Sm)
            .border(1.dp, if (on) c.brand.copy(alpha = 0.55f) else c.borderSubtle, Radii.Sm)
            .pressable(remember { MutableInteractionSource() }, role = if (radio) Role.RadioButton else Role.Checkbox, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (radio) {
            Box(Modifier.size(20.dp).border(2.dp, if (on) c.brand else c.borderStrong, CircleShape), contentAlignment = Alignment.Center) {
                if (on) Box(Modifier.size(10.dp).background(c.brand, CircleShape))
            }
        } else {
            Box(
                Modifier.size(20.dp).background(if (on) c.brand else Color.Transparent, RoundedCornerShape(6.dp)).border(2.dp, if (on) c.brand else c.borderStrong, RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) { if (on) Icon("Check", c.onBrand, size = 14.dp) }
        }
        if (emoji != null) HookEmojiGlyph(emoji, 20)
        Column(Modifier.weight(1f)) {
            Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = if (on) c.textStrong else c.text)
            if (!description.isNullOrEmpty()) Txt(description, style = Nx.type.hint, color = c.textMuted)
        }
    }
}

/** Files for a form's file field: chosen, sent up as they are chosen, listed with a way to take each back. */
@Composable
private fun FileField(f: FormField, files: List<InteractionFile>, onFiles: (List<InteractionFile>) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val max = maxOf(1, f.maxValues ?: 1)
    val current by androidx.compose.runtime.rememberUpdatedState(files)
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        busy = true
        error = null
        scope.launch {
            val next = current.toMutableList()
            try {
                for (uri in uris.take(max - next.size)) {
                    val picked = ServerApi.read(context, uri)
                    next += Apps.sendFile(picked.name, picked.type, picked.bytes)
                }
            } catch (e: Exception) {
                error = describeError(e, t("apps.form.fileFailed"))
            }
            onFiles(next)
            busy = false
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (x in files) Row(
            Modifier.fillMaxWidth().background(c.bgSurface, Radii.Sm).border(1.dp, c.borderSubtle, Radii.Sm).padding(start = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("FileUp", c.icon, size = 16.dp)
            Txt(x.filename, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(550)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f))
            Txt(Time.bytes(x.size), style = Nx.type.hint, color = c.textMuted)
            fish.nexa.ui.components.IconButton("X", t("apps.form.removeFile", "name" to x.filename), { onFiles(files.filter { it.id != x.id }) }, tint = c.textMuted, iconSize = 16.dp)
        }
        if (files.size < max) NxButton(
            if (max > 1) t("apps.form.chooseFiles") else t("apps.form.chooseFile"),
            { pick.launch(f.fileTypes?.firstOrNull()?.takeIf { it.contains('/') } ?: "*/*") },
            kind = ButtonKind.SECONDARY,
            size = fish.nexa.ui.components.ButtonSize.TOUCH,
            icon = "FileUp",
            loading = busy,
        )
        error?.let { Txt(it, style = Nx.type.hint, color = c.textDanger) }
    }
}
