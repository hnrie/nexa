package fish.nexa.ui.moderation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.*
import fish.nexa.ui.chat.PersonName
import fish.nexa.ui.components.*
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
fun ReportsTab(id: String?) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val generation = remember { java.util.concurrent.atomic.AtomicInteger(0) }
    var status by remember { mutableStateOf("active") }
    var kind by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var mine by remember { mutableStateOf(false) }
    var list by remember { mutableStateOf<List<SafetyReport>>(emptyList()) }
    var more by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var counts by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var refresh by remember { mutableIntStateOf(0) }
    val queueScroll = androidx.compose.foundation.lazy.rememberLazyListState()
    if (id != null) {
        ReportWorkspace(id)
        return
    }
    LaunchedEffect(status, kind, query, mine, refresh) {
        val ticket = generation.incrementAndGet()
        list = emptyList()
        more = false
        loading = true
        error = ""
        delay(200)
        try {
            val r = Reports.list(status, kind, query, mine)
            if (ticket != generation.get()) return@LaunchedEffect
            list = r.reports
            more = r.hasMore
            counts = r.counts
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = describeError(e, t("reports.failed"))
        } finally {
            loading = false
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        state = queueScroll,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Txt(
                t("reports.title") + " (${(counts["open"]?:0)+(counts["in_review"]?:0)})",
                style = Nx.type.heading,
                color = c.textStrong,
            )
        }
        item {
            NxTextField(query, { if (it.length <= 200) query = it }, label = t("reports.search"))
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SelectField(
                    t("reports.status"),
                    listOf("active" to t("reports.active"), "" to t("reports.all")) +
                        Reports.statuses.map { it to t("reports.status.$it") },
                    status,
                    Modifier.weight(1f),
                ) {
                    status = it
                }
                SelectField(
                    t("reports.target"),
                    listOf("" to t("reports.allKinds")) +
                        Reports.kinds.map { it to t("reports.kind.$it") },
                    kind,
                    Modifier.weight(1f),
                ) {
                    kind = it
                }
            }
        }
        item { NxCheckbox(mine, { mine = it }, t("reports.mine")) }
        item {
            NxButton(
                t("reports.refresh"),
                { refresh++ },
                kind = ButtonKind.SECONDARY,
                enabled = !loading,
            )
        }
        if (error.isNotEmpty()) item { Txt(error, style = Nx.type.bodySmall, color = c.textDanger) }
        if (list.isEmpty() && !loading)
            item { Txt(t("reports.empty"), style = Nx.type.body, color = c.textMuted) }
        items(list, key = { it.id }) { v ->
            Column(
                Modifier.fillMaxWidth()
                    .pressable(
                        interaction =
                            remember {
                                androidx.compose.foundation.interaction.MutableInteractionSource()
                            }
                    ) {
                        goPanel("reports/${v.id}")
                    }
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Txt(
                    t("reports.reason.${v.reason}"),
                    style = Nx.type.heading,
                    color = c.textStrong,
                    maxLines = 2,
                )
                Txt(v.description, style = Nx.type.body, color = c.text, maxLines = 2)
                Txt(
                    t("reports.kind.${v.targetKind}") + " / " + t("reports.status.${v.status}"),
                    style = Nx.type.bodySmall,
                    color = c.textMuted,
                )
                Txt(date(v.createdAt), style = Nx.type.bodySmall, color = c.textMuted)
            }
        }
        if (loading)
            item { Txt(t("reports.loading"), style = Nx.type.bodySmall, color = c.textMuted) }
        if (more)
            item {
                NxButton(
                    t("reports.more"),
                    {
                        if (loading) return@NxButton
                        val ticket = generation.get()
                        val before = list.lastOrNull()?.id ?: ""
                        loading = true
                        scope.launch {
                            try {
                                val r = Reports.list(status, kind, query, mine, before)
                                if (ticket == generation.get()) {
                                    list = list + r.reports
                                    more = r.hasMore
                                    counts = r.counts
                                }
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                if (ticket == generation.get())
                                    error = describeError(e, t("reports.failed"))
                            } finally {
                                if (ticket == generation.get()) loading = false
                            }
                        }
                    },
                    kind = ButtonKind.SECONDARY,
                    enabled = !loading,
                )
            }
    }
}

private fun date(at: Long) =
    java.text.DateFormat.getDateTimeInstance(
            java.text.DateFormat.MEDIUM,
            java.text.DateFormat.SHORT,
        )
        .format(java.util.Date(at))

@Composable
private fun ReportWorkspace(id: String) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val meUser by Nexa.users.me.collectAsState()
    val rank = StaffRanks.of(meUser?.id, meUser?.flags ?: 0L)
    var showDetails by remember(id) { mutableStateOf(false) }
    var tab by remember(id) { mutableStateOf("report") }
    var saved by remember(id) { mutableStateOf(false) }
    var removeReason by remember(id) { mutableStateOf("") }
    var detail by remember(id) { mutableStateOf<SafetyReportDetail?>(null) }
    var status by remember(id) { mutableStateOf("open") }
    var note by remember(id) { mutableStateOf("") }
    var error by remember(id) { mutableStateOf("") }
    var busy by remember(id) { mutableStateOf(false) }
    var reload by remember(id) { mutableIntStateOf(0) }
    LaunchedEffect(id, reload) {
        try {
            val r = Reports.detail(id)
            detail = r
            status = r.report.status
            error = ""
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = describeError(e, t("reports.failed"))
        }
    }
    fun review(assigned: String, assignmentOnly: Boolean = false) {
        val v = detail?.report ?: return
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val r =
                    Reports.review(
                        v,
                        if (assignmentOnly) v.status else status,
                        if (assignmentOnly) "" else note,
                        assigned,
                    )
                detail = r
                if (!assignmentOnly) {
                    status = r.report.status
                    note = ""
                    saved = true
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = describeError(e, t("reports.failed"))
            } finally {
                busy = false
            }
        }
    }
    val v = detail?.report
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item {
            NxButton(
                t("reports.back"),
                { fish.nexa.ui.nav.Nav.returnTo(fish.nexa.ui.nav.Route.Admin("reports")) },
                kind = ButtonKind.GHOST,
            )
        }
        if (error.isNotEmpty())
            item {
                Txt(error, style = Nx.type.body, color = c.textDanger)
                NxButton(t("reports.refresh"), { reload++ }, enabled = !busy)
            }
        if (v == null && error.isEmpty())
            item { Txt(t("reports.loading"), style = Nx.type.body, color = c.textMuted) }
        if (v != null) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Txt(t("reports.kind.${v.targetKind}"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(26f)), color = c.textStrong, modifier = Modifier.weight(1f))
                    Txt(t("reports.status.${v.status}"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = if (v.status == "open") c.textBrand else c.textSubtle)
                }
                Spacer(Modifier.height(8.dp))
                Txt(
                    date(v.createdAt),
                    style = Nx.type.bodySmall,
                    color = c.textMuted,
                )
            }
            item {
                val me = Nexa.users.meId
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Txt(t("reports.assignment"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textMuted)
                        val assigned = detail!!.people[v.assignedTo]
                        Txt(if (v.assignedTo == "0") t("reports.unassigned") else assigned?.displayName?.ifEmpty { assigned.username } ?: v.assignedTo, style = Nx.type.body, color = c.text)
                    }
                    NxButton(if (v.assignedTo == me) t("reports.unassign") else t("reports.claim"), { review(if (v.assignedTo == me) "0" else me ?: "0", true) }, kind = ButtonKind.SECONDARY, size = ButtonSize.LG, enabled = !busy && me != null)
                }
                Spacer(Modifier.height(24.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                            "report" to "reports.reportTab",
                            "review" to "reports.review",
                            "history" to "reports.historyTab",
                        )
                        .forEach { (key, label) ->
                            NxButton(
                                t(label),
                                { tab = key },
                                Modifier.weight(1f),
                                kind = if (tab == key) ButtonKind.SECONDARY else ButtonKind.GHOST,
                                size = ButtonSize.LG,
                            )
                        }
                }
            }
            if (tab == "report") {
                item {
                    Txt(
                        t("reports.reason.${v.reason}"),
                        style = Nx.type.heading.copy(fontSize = Nx.type.sp(18f)),
                        color = c.textStrong,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    Txt(v.description, style = Nx.type.body, color = c.text)
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        ReportPerson(t("reports.reporter"), v.reporterId, detail!!)
                        ReportPerson(t("reports.subject"), v.subjectId, detail!!)
                    }
                }
                item {
                    Txt(t("reports.evidence"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(18f)), color = c.textStrong, modifier = Modifier.padding(bottom = 8.dp))
                    Txt(t("reports.unverified"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textSubtle)
                    v.snapshot["message_content"]?.jsonObject?.let { content ->
                        val ch = v.snapshot["channel_id"]!!.jsonPrimitive.content
                        val channel = Nexa.channels.get(ch) ?: fish.nexa.net.Channel(id = ch)
                        val cm = ChatMessage(
                            fish.nexa.net.Message(v.targetId, ch, v.subjectId, type = content["type"]?.jsonPrimitive?.content ?: "default", createdAt = v.snapshot["created_at"]?.jsonPrimitive?.longOrNull ?: v.createdAt, editedAt = v.snapshot["edited_at"]?.jsonPrimitive?.longOrNull),
                            payload = fish.nexa.crypto.MessageCrypto.sanitizePayload(JsonObject(content.filterKeys { it !in listOf("att", "sticker") })),
                            hook = content["hook"] as? JsonObject,
                            call = content["call"] as? JsonObject,
                        )
                        fish.nexa.ui.chat.MessageRow(
                            fish.nexa.ui.chat.MsgItem(cm.id, cm = cm, groupStart = true),
                            fish.nexa.ui.chat.ListCtx(channel, Nexa.servers.byId.value[channel.serverId], false, false, Nexa.users.meId ?: ""),
                            null, false, false, preview = true, previewAuthor = detail!!.people[v.subjectId],
                            evidence = {
                                v.snapshot["message_sticker"]?.jsonObject?.let { sticker ->
                                    ReportFile(NexaFile(sticker["blob_id"]!!.jsonPrimitive.content, sticker["name"]?.jsonPrimitive?.content ?: "", "image/*"), sticker["format"]?.jsonPrimitive?.content)
                                }
                                detail!!.files.forEach { ReportFile(it) }
                            },
                        )
                    }
                    if (v.excerpt.isNotEmpty() || v.snapshot["message_content"] == null)
                        Txt(
                            v.excerpt.ifEmpty { t("reports.noExcerpt") },
                            style = Nx.type.body,
                            color = c.text,
                        )
                }
                v.snapshot["message_sticker"]?.jsonObject?.takeIf { v.snapshot["message_content"] == null }?.let { sticker ->
                    item {
                        ReportFile(
                            NexaFile(
                                sticker["blob_id"]!!.jsonPrimitive.content,
                                sticker["name"]?.jsonPrimitive?.content ?: "",
                                "image/*",
                            ),
                            sticker["format"]?.jsonPrimitive?.content,
                        )
                    }
                }
                items(if (v.snapshot["message_content"] == null) detail!!.files else emptyList(), key = { it.id }) { file -> ReportFile(file) }
                item {
                    NxButton(
                        t("reports.sharedDetails"),
                        { showDetails = !showDetails },
                        kind = ButtonKind.GHOST,
                        size = ButtonSize.SM,
                    )
                }
                if (showDetails) item { Txt("#" + v.id, style = Nx.type.bodySmall, color = c.textMuted) }
                if (showDetails)
                    items(
                        v.snapshot
                            .filterKeys { it != "message_content" && it != "message_sticker" }
                            .entries
                            .toList(),
                        key = { it.key },
                    ) { (key, value) ->
                        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Txt(
                                key.replace('_', ' '),
                                style = Nx.type.bodySmall,
                                color = c.textMuted,
                            )
                            if (
                                key in
                                    listOf(
                                        "avatar_id",
                                        "banner_id",
                                        "icon_id",
                                        "blob_id",
                                        "cover_blob_id",
                                    ) &&
                                    value is JsonPrimitive &&
                                    value.contentOrNull != null &&
                                    value != JsonNull
                            )
                                ReportFile(
                                    NexaFile(value.content, key, "image/*"),
                                    (v.snapshot[
                                                if (key == "cover_blob_id") "cover_format"
                                                else "format"]
                                            as? JsonPrimitive)
                                        ?.contentOrNull,
                                )
                            else
                                Txt(
                                    if (value is JsonPrimitive) value.content else value.toString(),
                                    style = Nx.type.body,
                                    color = c.text,
                                )
                        }
                    }
            }
            if (tab == "review") {
                item {
                    Txt(t("reports.actions"), style = Nx.type.heading, color = c.textStrong)
                    Txt(t("reports.actionHint"), style = Nx.type.bodySmall, color = c.textMuted)
                }
                if (v.subjectId != "0")
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            NxButton(
                                t("reports.moderateAccount"),
                                {
                                    if (!busy) {
                                        busy = true
                                        scope.launch {
                                            try {
                                                val p = Moderation.user(v.subjectId)
                                                openModerate(p.user, p.servers) { case ->
                                                    note =
                                                        listOf(
                                                                note,
                                                                t(
                                                                    "reports.caseRecorded",
                                                                    "number" to case.number,
                                                                ),
                                                            )
                                                            .filter { it.isNotBlank() }
                                                            .joinToString("\n")
                                                }
                                            } catch (e: Exception) {
                                                if (e is CancellationException) throw e
                                                error = describeError(e, t("reports.failed"))
                                            } finally {
                                                busy = false
                                            }
                                        }
                                    }
                                },
                                enabled = !busy,
                            )
                            NxButton(
                                t("reports.openAccount"),
                                { openReportTarget("users/${v.subjectId}", v.id) },
                                kind = ButtonKind.SECONDARY,
                            )
                        }
                    }
                if (rank?.atLeast(StaffRank.ADMIN) == true && v.serverId != "0")
                    item {
                        NxButton(
                            t("reports.openServer"),
                            { openReportTarget("servers/${v.serverId}", v.id) },
                            kind = ButtonKind.SECONDARY,
                        )
                    }
                if (
                    rank?.atLeast(StaffRank.ADMIN) == true &&
                        v.targetKind in listOf("pack", "sticker")
                )
                    item {
                        NxButton(
                            t("reports.openPack"),
                            {
                                val pid =
                                    if (v.targetKind == "pack") v.targetId
                                    else v.snapshot["pack_id"]!!.jsonPrimitive.content
                                openReportTarget("expressions/packs/$pid", v.id)
                            },
                            kind = ButtonKind.SECONDARY,
                        )
                    }
                item {
                    Txt(t("reports.review"), style = Nx.type.heading, color = c.textStrong)
                    SelectField(
                        t("reports.status"),
                        Reports.statuses.map { it to t("reports.status.$it") },
                        status,
                        enabled = !busy,
                    ) {
                        status = it
                    }
                }
                item {
                    NxTextField(
                        note,
                        { if (it.length <= 2000) note = it },
                        label = t("reports.staffNote"),
                        hint = t("reports.noteHint"),
                        singleLine = false,
                        minLines = 3,
                        enabled = !busy,
                    )
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (rank?.atLeast(StaffRank.ADMIN) == true && v.targetKind == "message") {
                            NxTextField(
                                removeReason,
                                { if (it.length <= 1000) removeReason = it },
                                label = t("moderation.form.reason"),
                                hint = t("moderation.form.reasonVisible"),
                                singleLine = false,
                                minLines = 2,
                                enabled = !busy,
                            )
                            NxButton(
                                t("chat.messageMenu.deleteMessage"),
                                {
                                    if (!busy && removeReason.trim().length >= 3) {
                                        fish.nexa.ui.layers.openSheet(
                                            "removeReportedMessage",
                                            title = t("chat.messageMenu.deleteMessage"),
                                        ) { close ->
                                            Txt(
                                                removeReason,
                                                style = Nx.type.body,
                                                color = Nx.colors.text,
                                            )
                                            NxButton(
                                                t("chat.messageMenu.deleteMessage"),
                                                {
                                                    close()
                                                    busy = true
                                                    scope.launch {
                                                        try {
                                                            Nexa.api.request(
                                                                "POST",
                                                                "/moderation/reports/${v.id}/remove-message",
                                                                buildJsonObject {
                                                                    put("version", v.version)
                                                                    put(
                                                                        "reason",
                                                                        removeReason.trim(),
                                                                    )
                                                                },
                                                            )
                                                            reload++
                                                        } catch (e: Exception) {
                                                            if (e is CancellationException) throw e
                                                            error =
                                                                describeError(
                                                                    e,
                                                                    t("reports.failed"),
                                                                )
                                                        } finally {
                                                            busy = false
                                                        }
                                                    }
                                                },
                                                kind = ButtonKind.DANGER,
                                            )
                                        }
                                    }
                                },
                                kind = ButtonKind.DANGER,
                                enabled = !busy && removeReason.trim().length >= 3,
                            )
                        }
                        NxButton(
                            t("reports.save"),
                            { review(v.assignedTo) },
                            enabled =
                                !busy &&
                                    (status !in listOf("actioned", "dismissed") ||
                                        note.trim().length >= 3),
                            loading = busy,
                        )
                    }
                }
                if (saved)
                    item { Txt(t("reports.saved"), style = Nx.type.bodySmall, color = c.textBrand) }
            }
            if (tab == "history") {
                item { Txt(t("reports.history"), style = Nx.type.heading, color = c.textStrong) }
                if (detail!!.events.isEmpty())
                    item {
                        Txt(t("reports.noHistory"), style = Nx.type.bodySmall, color = c.textMuted)
                    }
                items(detail!!.events, key = { it.id }) { e ->
                    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        ReportPerson(t("reports.review"), e.actorId, detail!!)
                        Txt(
                            t("reports.status.${e.status}") + " / " + date(e.createdAt),
                            style = Nx.type.bodySmall,
                            color = c.textMuted,
                        )
                        ReportPerson(t("reports.assignment"), e.assignedTo, detail!!)
                        if (e.note.isNotEmpty()) Txt(e.note, style = Nx.type.body, color = c.text)
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportPerson(label: String, id: String, detail: SafetyReportDetail) {
    val c = Nx.colors
    val p = detail.people[id]
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Txt(
            label,
            style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)),
            color = c.textMuted,
            modifier = Modifier.width(100.dp),
        )
        if (id == "0") Txt(t("reports.unspecified"), style = Nx.type.bodySmall, color = c.textMuted)
        else
            PersonName(
                id,
                p?.displayName?.ifEmpty { p.username } ?: id,
                style = Nx.type.body,
                color = c.text,
                modifier = Modifier.weight(1f),
                maxLines = 2,
            )
    }
}

@Composable
private fun ReportFile(file: NexaFile, format: String? = null) {
    val c = Nx.colors
    var local by remember(file.id) { mutableStateOf<java.io.File?>(null) }
    var error by remember(file.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var loading by remember(file.id) { mutableStateOf(false) }
    suspend fun load() {
        loading = true
        error = false
        try {
            local = PrivateFiles.file("reports", file.id)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = true
        } finally {
            loading = false
        }
    }
    LaunchedEffect(file.id) {
        if (
            file.size <= 256L * 1024 * 1024 &&
                (file.mime.startsWith("image/") || file.mime.startsWith("video/") || format != null)
        )
            load()
    }
    Column {
        if (format != null && local != null)
            fish.nexa.ui.chat.StickerMedia(
                format,
                android.net.Uri.fromFile(local).toString(),
                file.name,
                180.dp,
            )
        else if (file.mime.startsWith("image/") && local != null)
            AsyncImage(
                local,
                contentDescription = file.name,
                modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp),
            )
        Txt(file.name, style = Nx.type.bodySmall, color = c.text)
        if (error) Txt(t("reports.failed"), style = Nx.type.bodySmall, color = c.textDanger)
        NxButton(
            t("reports.openFile"),
            {
                local?.let { openEvidence(it, file.mime, file.name) }
                    ?: scope.launch {
                        load()
                        local?.let { openEvidence(it, file.mime, file.name) }
                    }
            },
            kind = ButtonKind.SECONDARY,
            enabled = !loading,
            loading = loading,
        )
    }
}

private fun openEvidence(file: java.io.File, mime: String, name: String) {
    Nexa.scope.launch {
        try {
            val context = Nexa.app
            val copy =
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
                    val out =
                        java.io.File(
                            dir,
                            "report-" +
                                file.name +
                                "." +
                                (android.webkit.MimeTypeMap.getSingleton()
                                    .getExtensionFromMimeType(mime) ?: "bin"),
                        )
                    file.copyTo(out, true)
                    out
                }
            val uri =
                androidx.core.content.FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.files",
                    copy,
                )
            val intent =
                android.content
                    .Intent(android.content.Intent.ACTION_VIEW)
                    .setDataAndType(uri, mime)
                    .addFlags(
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                    )
            context.startActivity(
                android.content.Intent.createChooser(intent, name)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Nexa.ui.toast(t("reports.failed"), "error")
        }
    }
}
