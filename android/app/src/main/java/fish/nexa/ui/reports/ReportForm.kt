package fish.nexa.ui.reports

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.*
import fish.nexa.ui.components.*
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

fun reportItem(context: ReportContext) =
    MenuItem.Action(
        if (context.kind == "application")
            t("reports.report") + ": " + t("reports.kind.application")
        else t("reports.report")
    ) {
        openReport(context)
    }

fun openReport(context: ReportContext = ReportContext()) {
    val busy = mutableStateOf(false)
    val submitState = ReportSubmit()
    openSheet(
        "reportContent",
        title = t("reports.report"),
        canClose = { !busy.value },
        footer = { close ->
            NxButton(
                if (submitState.sent) t("reports.close") else t("reports.send"),
                { if (submitState.sent) close() else submitState.submit() },
                enabled = submitState.sent || (submitState.enabled && !busy.value),
                loading = busy.value,
                block = true,
            )
        },
    ) { _ ->
        ReportForm(context, busy, submitState)
    }
}

private class ReportSubmit {
    var submit: () -> Unit by mutableStateOf({})
    var enabled by mutableStateOf(false)
    var sent by mutableStateOf(false)
}

@Composable
private fun ReportForm(
    context: ReportContext,
    busyState: MutableState<Boolean>,
    submitState: ReportSubmit,
) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf(context.kind ?: "other") }
    var id by remember { mutableStateOf(context.id ?: "") }
    val part = if (kind == "other") "custom" else "whole"
    var target by remember { mutableStateOf<SafetyReportTarget?>(null) }
    var loading by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("harassment") }
    var description by remember { mutableStateOf("") }
    val custom = if (kind == "other") description.take(120) else ""
    var preview by remember { mutableStateOf<ChatMessage?>(null) }
    var message by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf("") }
    val requestId = remember { java.util.UUID.randomUUID().toString() }
    val busy = busyState.value
    LaunchedEffect(kind, id, context.serverId) {
        target = null
        loading = false
        message = null
        preview = null
        error = ""
        if (kind != "other" && !id.matches(Regex("[0-9]{1,20}"))) return@LaunchedEffect
        loading = true
        try {
            val r = Reports.target(kind, id.ifEmpty { "0" }, context.serverId)
            if (kind == "message") message = Reports.fullMessage(r) { preview = it }
            target = r
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = describeError(e, t("reports.failed"))
        } finally {
            loading = false
        }
    }
    val evidenceText = if (kind == "message") "" else context.evidence.joinToString("\n\n") { it.text }
    val valid =
        target != null &&
            (kind != "message" || message != null) &&
            description.trim().length >= 3 &&
            (part != "custom" || custom.isNotBlank()) &&
            evidenceText.length <= 16000
    val submit: () -> Unit = submit@{
        if (!valid || busyState.value) return@submit
        busyState.value = true
        error = ""
        scope.launch {
            try {
                val body = buildJsonObject {
                    put("request_id", requestId)
                    put("target_kind", kind)
                    if (kind == "message") put("message", message!!)
                    put("target_id", target!!.id)
                    context.serverId?.let { put("server_id", it) }
                    put("part", part)
                    put("custom_part", custom)
                    put("reason", reason)
                    put("description", description)
                    put("excerpt", evidenceText)
                    put("files", JsonArray(emptyList()))
                }
                receipt = Reports.send(body)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = describeError(e, t("reports.failed"))
            } finally {
                busyState.value = false
            }
        }
    }
    SideEffect {
        submitState.submit = submit
        submitState.enabled = valid
        submitState.sent = receipt.isNotEmpty()
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (receipt.isNotEmpty()) {
            Txt(t("reports.sent"), style = Nx.type.heading, color = c.textStrong)
            Txt(t("reports.receipt"), style = Nx.type.body, color = c.text)
            Txt(receipt, style = Nx.type.bodySmall, color = c.textMuted)
            return@Column
        }
        if (kind != "message") Txt(
            t("reports.privacy"),
            style = Nx.type.bodySmall,
            color = c.textSubtle,
        )
        if (context.kind == null)
            SelectField(
                t("reports.target"),
                Reports.kinds.map { it to t("reports.kind.$it") },
                kind,
                enabled = !busy,
            ) {
                kind = it
                id = ""
            }
        else if (kind != "message") Txt(t("reports.kind.$kind"), style = Nx.type.body, color = c.textStrong)
        if (context.id == null && kind != "other")
            NxTextField(
                id,
                { if (it.length <= 20) id = it },
                label = t("reports.targetId"),
                enabled = !busy,
            )
        SelectField(
            t("reports.reason"),
            Reports.reasons.map { it to t("reports.reason.$it") },
            reason,
            enabled = !busy,
        ) {
            reason = it
        }
        if (kind == "message") {
            preview?.let { cm ->
                val channel = Nexa.channels.get(cm.channelId) ?: fish.nexa.net.Channel(id = cm.channelId)
                fish.nexa.ui.chat.MessageRow(
                    fish.nexa.ui.chat.MsgItem(cm.id, cm = cm, groupStart = true),
                    fish.nexa.ui.chat.ListCtx(channel, Nexa.servers.byId.value[channel.serverId], false, false, Nexa.users.meId ?: ""),
                    null, false, false, preview = true,
                )
            }
            Txt(t("reports.fullMessageNotice"), style = Nx.type.bodySmall, color = c.textSubtle)
        }
        if (kind != "message") target?.snapshot?.let { snapshot ->
            val image = snapshot["avatar_id"] ?: snapshot["icon_id"]
            if (image is JsonPrimitive && image.contentOrNull != null) Avatar(target!!.id, snapshot["name"]?.jsonPrimitive?.content ?: snapshot["display_name"]?.jsonPrimitive?.content ?: "", image.content, 40.dp, icon = snapshot["avatar_id"] == null)
            val blob = (snapshot["blob_id"] ?: snapshot["cover_blob_id"])?.jsonPrimitive?.contentOrNull
            if (blob != null) coil3.compose.AsyncImage(model = if (kind == "emoji") fish.nexa.media.Media.emojiUrl(blob, 96, 1f) else fish.nexa.media.Media.stickerUrl(blob, 180, 1f), contentDescription = snapshot["name"]?.jsonPrimitive?.content, modifier = Modifier.size(120.dp))
            snapshot.filterKeys { it in listOf("username", "display_name", "name", "description", "about_me", "pronouns", "status_text", "topic", "tags") }.forEach { (key, value) ->
                if (value !is JsonNull && value.toString() != "\"\"") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Txt(t("reports.part.$key"), style = Nx.type.bodySmall, color = c.textMuted, modifier = Modifier.width(100.dp))
                        Txt((value as? JsonPrimitive)?.content ?: value.toString(), style = Nx.type.body, color = c.text, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
        if (kind != "message") context.evidence.forEach { fish.nexa.ui.markdown.MarkdownView(it.text, fish.nexa.ui.markdown.RenderCtx()) }
        NxTextField(
            description,
            { if (it.length <= 4000) description = it },
            label = t("reports.description"),
            hint = t("reports.descriptionHint"),
            required = true,
            singleLine = false,
            minLines = 4,
            enabled = !busy,
        )
        if (loading) Txt(t("reports.loading"), style = Nx.type.bodySmall, color = c.textMuted)
        if (evidenceText.length > 16000)
            Txt(t("reports.evidenceTooLong"), style = Nx.type.bodySmall, color = c.textDanger)
        if (error.isNotEmpty()) Txt(error, style = Nx.type.bodySmall, color = c.textDanger)
    }
}
