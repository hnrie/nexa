package fish.nexa.ui.reports

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.*
import fish.nexa.net.UriBody
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

private class ReportFile(val uri: Uri, val name: String, val type: String, val size: Long) {
    var uploaded: String? = null
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
    var message by remember { mutableStateOf<JsonObject?>(null) }
    var excerpt by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<Int>() }
    val requestId = remember { java.util.UUID.randomUUID().toString() }
    val files = remember { mutableStateListOf<ReportFile>() }
    val busy = busyState.value
    LaunchedEffect(kind, id, context.serverId) {
        target = null
        loading = false
        message = null
        error = ""
        if (kind != "other" && !id.matches(Regex("[0-9]{1,20}"))) return@LaunchedEffect
        loading = true
        try {
            val r = Reports.target(kind, id.ifEmpty { "0" }, context.serverId)
            if (kind == "message") message = Reports.fullMessage(r)
            target = r
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = describeError(e, t("reports.failed"))
        } finally {
            loading = false
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            val resolver = Nexa.app.contentResolver
            for (uri in uris) {
                val type = resolver.getType(uri) ?: ""
                var name = ""
                var size = 0L
                runCatching {
                    resolver
                        .query(
                            uri,
                            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                            null,
                            null,
                            null,
                        )
                        ?.use { cur ->
                            if (cur.moveToFirst()) {
                                name = cur.getString(0) ?: ""
                                size = cur.getLong(1)
                            }
                        }
                }
                val allowed =
                    type in
                        listOf(
                            "image/png",
                            "image/jpeg",
                            "image/gif",
                            "image/webp",
                            "video/mp4",
                            "video/quicktime",
                            "video/webm",
                        )
                if (
                    !allowed ||
                        files.size >= 5 ||
                        size < 0 ||
                        size > (if (type.startsWith("image/")) 10L else 50L) * 1024 * 1024 ||
                        files.sumOf { it.size } + size > 100L * 1024 * 1024
                ) {
                    error = t("reports.filesHint")
                    continue
                }
                files.add(ReportFile(uri, name, type, size))
            }
        }
    val evidenceText =
        selected
            .mapNotNull { context.evidence.getOrNull(it)?.text }
            .plus(excerpt.takeIf { it.isNotBlank() })
            .filterNotNull()
            .joinToString("\n\n")
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
                for (f in files) if (f.uploaded == null) {
                    val path =
                        "/reports/attachments?name=" + java.net.URLEncoder.encode(f.name, "UTF-8")
                    val req =
                        Nexa.api
                            .requestBuilder(path)
                            .post(UriBody(f.uri, f.type, f.size) {})
                            .header("Content-Type", f.type)
                            .build()
                    f.uploaded =
                        Nexa.api
                            .execute(Nexa.api.http, req, true)
                            .jsonObject["id"]!!
                            .jsonPrimitive
                            .content
                }
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
                    put(
                        "files",
                        JsonArray(
                            files.map { f ->
                                buildJsonObject {
                                    put("id", f.uploaded!!)
                                    put("name", f.name)
                                }
                            }
                        ),
                    )
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
        Txt(
            t(if (kind == "message") "reports.fullMessageNotice" else "reports.privacy"),
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
                selected.clear()
            }
        else Txt(t("reports.kind.$kind"), style = Nx.type.body, color = c.textStrong)
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
        if (kind == "message") {
            message?.get("content")?.jsonObject?.let { content ->
                (content["t"] as? JsonPrimitive)?.contentOrNull?.let {
                    Txt(it, style = Nx.type.body, color = c.text)
                }
                content
                    .filterKeys { it !in listOf("t", "type", "flags", "att") }
                    .forEach { (key, value) ->
                        Txt(value.toString(), style = Nx.type.bodySmall, color = c.text)
                    }
                message
                    ?.get("attachments")
                    ?.jsonArray
                    ?.filter { it.jsonObject["preview"]?.jsonPrimitive?.booleanOrNull != true }
                    ?.forEach { a ->
                        Txt(
                            a.jsonObject["name"]!!.jsonPrimitive.content,
                            style = Nx.type.bodySmall,
                            color = c.textMuted,
                        )
                    }
            }
        }
        if (kind != "message" && context.evidence.isNotEmpty()) {
            Txt(t("reports.chooseEvidence"), style = Nx.type.bodySmall, color = c.textStrong)
            Txt(t("reports.selectedOnly"), style = Nx.type.bodySmall, color = c.textMuted)
            context.evidence.forEachIndexed { i, e ->
                Column {
                    NxCheckbox(
                        i in selected,
                        { on -> if (on) selected.add(i) else selected.remove(i) },
                        e.label,
                        enabled = !busy,
                    )
                    Txt(e.text, style = Nx.type.bodySmall, color = c.text, maxLines = 8)
                }
            }
        }
        if (kind != "message")
            NxTextField(
                excerpt,
                { if (it.length <= 16000) excerpt = it },
                label = t("reports.excerpt"),
                hint = t("reports.excerptHint"),
                singleLine = false,
                minLines = 3,
                enabled = !busy,
            )
        NxButton(
            t("reports.files"),
            {
                picker.launch(
                    arrayOf(
                        "image/png",
                        "image/jpeg",
                        "image/gif",
                        "image/webp",
                        "video/mp4",
                        "video/quicktime",
                        "video/webm",
                    )
                )
            },
            kind = ButtonKind.SECONDARY,
            enabled = !busy,
        )
        Txt(t("reports.filesHint"), style = Nx.type.bodySmall, color = c.textMuted)
        files.toList().forEach { f ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(
                    f.name,
                    style = Nx.type.bodySmall,
                    color = c.text,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                )
                NxButton(
                    t("reports.remove"),
                    { files.remove(f) },
                    kind = ButtonKind.GHOST,
                    size = ButtonSize.SM,
                    enabled = !busy,
                )
            }
        }
        var showSnapshot by remember { mutableStateOf(false) }
        if (target?.snapshot?.isNotEmpty() == true) {
            NxButton(
                t("reports.sharedDetails"),
                { showSnapshot = !showSnapshot },
                kind = ButtonKind.GHOST,
            )
            if (showSnapshot) {
                Txt(t("reports.snapshotHint"), style = Nx.type.bodySmall, color = c.textMuted)
                Txt(target!!.snapshot.toString(), style = Nx.type.bodySmall, color = c.text)
            }
        }
        if (loading) Txt(t("reports.loading"), style = Nx.type.bodySmall, color = c.textMuted)
        if (evidenceText.length > 16000)
            Txt(t("reports.evidenceTooLong"), style = Nx.type.bodySmall, color = c.textDanger)
        if (error.isNotEmpty()) Txt(error, style = Nx.type.bodySmall, color = c.textDanger)
    }
}
