package fish.nexa.ui.dialogs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.t

/** One field of a prompt (PromptModal PromptField). */
data class PromptField(
    val key: String,
    val label: String,
    val initial: String = "",
    val placeholder: String? = null,
    val maxLength: Int? = null,
    val hint: String? = null,
)

/**
 * PromptModal: a title, one or more fields and the button that uses them,
 * off while the first field is empty (unless empty is allowed). The keyboard's
 * own action submits from the last field.
 */
fun promptFields(
    title: String,
    fields: List<PromptField>,
    confirmLabel: String = t("chat.editMessage.save"),
    allowEmpty: Boolean = false,
    onSubmit: (Map<String, String>) -> Unit,
) {
    lateinit var layer: Layer
    layer = Layer("prompt") { close ->
        PromptSheet(layer, title, fields, confirmLabel, allowEmpty, close, onSubmit)
    }
    Layers.open(layer)
}

/** promptText: one field, its value handed back when confirmed. */
fun promptText(
    title: String,
    label: String,
    initial: String = "",
    placeholder: String? = null,
    maxLength: Int? = null,
    hint: String? = null,
    confirmLabel: String = t("chat.editMessage.save"),
    allowEmpty: Boolean = false,
    onSubmit: (String) -> Unit,
) = promptFields(title, listOf(PromptField("value", label, initial, placeholder, maxLength, hint)), confirmLabel, allowEmpty) { onSubmit(it["value"] ?: "") }

@Composable
private fun PromptSheet(
    layer: Layer,
    title: String,
    fields: List<PromptField>,
    confirmLabel: String,
    allowEmpty: Boolean,
    close: () -> Unit,
    onSubmit: (Map<String, String>) -> Unit,
) {
    val values = remember { mutableStateMapOf<String, String>().apply { fields.forEach { put(it.key, it.initial) } } }
    val first = fields.firstOrNull()?.key ?: ""
    val ready = allowEmpty || !values[first].isNullOrBlank()
    fun submit() {
        if (!ready) return
        close()
        onSubmit(values.toMap())
    }
    Sheet(layer, title = title, maxWidth = 440.dp, footer = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(confirmLabel, ::submit, enabled = ready)
        }
    }) {
        fields.forEachIndexed { i, f ->
            NxTextField(
                value = values[f.key] ?: "",
                onValueChange = { v -> values[f.key] = f.maxLength?.let { v.take(it) } ?: v },
                label = f.label,
                placeholder = f.placeholder,
                hint = f.hint,
                imeAction = if (i == fields.lastIndex) ImeAction.Done else ImeAction.Next,
                onIme = if (i == fields.lastIndex) ({ submit() }) else null,
                capitalize = true,
            )
        }
    }
}
