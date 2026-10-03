package fish.nexa.ui.server

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.t

/** One box of a prompt: what it is called, what it starts with, how long it may be. */
class PromptField(val key: String, val label: String, val initial: String = "", val hint: String? = null, val maxLength: Int = 100, val capitalize: Boolean = false)

/**
 * PromptModal: a title, a few boxes and the button that does it. The first
 * box must hold something; Done on the keyboard in the last one confirms.
 */
fun promptFields(title: String, fields: List<PromptField>, confirmLabel: String, onDone: (Map<String, String>) -> Unit) {
    val values = mutableStateMapOf<String, String>().apply { fields.forEach { put(it.key, it.initial) } }
    fun ready() = values[fields.first().key]?.isNotBlank() == true
    openSheet("prompt", title = title, footer = { close ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(confirmLabel, {
                if (ready()) {
                    close()
                    onDone(values.toMap())
                }
            }, enabled = ready())
        }
    }) { close ->
        fields.forEachIndexed { i, f ->
            val last = i == fields.lastIndex
            NxTextField(
                values[f.key] ?: "",
                { values[f.key] = it.take(f.maxLength) },
                label = f.label,
                hint = f.hint,
                capitalize = f.capitalize,
                imeAction = if (last) ImeAction.Done else ImeAction.Next,
                onIme = if (last) ({
                    if (ready()) {
                        close()
                        onDone(values.toMap())
                    }
                }) else null,
            )
        }
    }
}

/** promptText: one box. */
fun promptText(title: String, field: PromptField, confirmLabel: String, onDone: (String) -> Unit) =
    promptFields(title, listOf(field), confirmLabel) { onDone(it[field.key] ?: "") }
