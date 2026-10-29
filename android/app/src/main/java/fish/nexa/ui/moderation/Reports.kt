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
    if (id != null) {
        ReportWorkspace(id)
        return
    }
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
            SelectField(
                t("reports.status"),
                listOf("active" to t("reports.active"), "" to t("reports.all")) +
                    Reports.statuses.map { it to t("reports.status.$it") },
                status,
            ) {
                status = it
            }
        }
        item {
            SelectField(
                t("reports.target"),
                listOf("" to t("reports.allKinds")) +
                    Reports.kinds.map { it to t("reports.kind.$it") },
                kind,
            ) {
                kind = it
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
                    t("reports.kind.${v.targetKind}") +
                        ": " +
                        if (v.part == "custom") v.customPart else t("reports.part.${v.part}"),
                    style = Nx.type.heading,
                    color = c.textStrong,
                    maxLines = 2,
                )
                Txt(v.description, style = Nx.type.body, color = c.text, maxLines = 2)
                Txt(
                    t("reports.reason.${v.reason}") + " / " + t("reports.status.${v.status}"),
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
    fun review(assigned: String) {
        val v = detail?.report ?: return
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val r = Reports.review(v, status, note, assigned)
                detail = r
                status = r.report.status
                note = ""
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
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { NxButton(t("reports.back"), { goPanel("reports") }, kind = ButtonKind.GHOST) }
        if (error.isNotEmpty())
            item {
                Txt(error, style = Nx.type.body, color = c.textDanger)
                NxButton(t("reports.refresh"), { reload++ }, enabled = !busy)
            }
        if (v == null && error.isEmpty())
            item { Txt(t("reports.loading"), style = Nx.type.body, color = c.textMuted) }
        if (v != null) {
            item {
                Txt(
                    t("reports.kind.${v.targetKind}") +
                        ": " +
                        if (v.part == "custom") v.customPart else t("reports.part.${v.part}"),
                    style = Nx.type.heading,
                    color = c.textStrong,
                )
                Txt(
                    v.id + " / " + date(v.createdAt),
                    style = Nx.type.bodySmall,
                    color = c.textMuted,
                )
            }
            item {
                Txt(t("reports.reason.${v.reason}"), style = Nx.type.heading, color = c.textStrong)
                Txt(v.description, style = Nx.type.body, color = c.text)
            }
            item {
                ReportPerson(t("reports.reporter"), v.reporterId, detail!!)
                ReportPerson(t("reports.subject"), v.subjectId, detail!!)
                ReportPerson(t("reports.assignment"), v.assignedTo, detail!!)
                Txt(
                    t("reports.targetId") + ": " + v.targetId,
                    style = Nx.type.bodySmall,
                    color = c.textMuted,
                )
            }
            item {
                Txt(t("reports.evidence"), style = Nx.type.heading, color = c.textStrong)
                Txt(t("reports.unverified"), style = Nx.type.bodySmall, color = c.textMuted)
                Txt(
                    v.excerpt.ifEmpty { t("reports.noExcerpt") },
                    style = Nx.type.body,
                    color = c.text,
                )
            }
            items(detail!!.files, key = { it.id }) { file -> ReportFile(file) }
            item {
                Txt(t("reports.sharedDetails"), style = Nx.type.heading, color = c.textStrong)
                Txt(t("reports.snapshotHint"), style = Nx.type.bodySmall, color = c.textMuted)
            }
            items(v.snapshot.entries.toList(), key = { it.key }) { (key, value) ->
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Txt(key.replace('_', ' '), style = Nx.type.bodySmall, color = c.textMuted)
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
                            (v.snapshot[if (key == "cover_blob_id") "cover_format" else "format"]
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
                            { goPanel("users/${v.subjectId}") },
                            kind = ButtonKind.SECONDARY,
                        )
                    }
                }
            if (rank?.atLeast(StaffRank.ADMIN) == true && v.serverId != "0")
                item {
                    NxButton(
                        t("reports.openServer"),
                        { goPanel("servers/${v.serverId}") },
                        kind = ButtonKind.SECONDARY,
                    )
                }
            if (rank?.atLeast(StaffRank.ADMIN) == true && v.targetKind in listOf("pack", "sticker"))
                item {
                    NxButton(
                        t("reports.openPack"),
                        {
                            val pid =
                                if (v.targetKind == "pack") v.targetId
                                else v.snapshot["pack_id"]!!.jsonPrimitive.content
                            goPanel("expressions/packs/$pid")
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
                                                                put("reason", removeReason.trim())
                                                            },
                                                        )
                                                        reload++
                                                    } catch (e: Exception) {
                                                        if (e is CancellationException) throw e
                                                        error =
                                                            describeError(e, t("reports.failed"))
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
                    val me = Nexa.users.meId
                    NxButton(
                        t("reports.claim"),
                        { review(me ?: "0") },
                        kind = ButtonKind.SECONDARY,
                        enabled = !busy && me != null && v.assignedTo != me,
                    )
                    if (v.assignedTo != "0")
                        NxButton(
                            t("reports.unassign"),
                            { review("0") },
                            kind = ButtonKind.GHOST,
                            enabled = !busy,
                        )
                }
            }
            item { Txt(t("reports.history"), style = Nx.type.heading, color = c.textStrong) }
            if (detail!!.events.isEmpty())
                item { Txt(t("reports.noHistory"), style = Nx.type.bodySmall, color = c.textMuted) }
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

@Composable
private fun ReportPerson(label: String, id: String, detail: SafetyReportDetail) {
    val c = Nx.colors
    val p = detail.people[id]
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Txt(
            label,
            style = Nx.type.bodySmall,
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
    LaunchedEffect(file.id) {
        try {
            local = PrivateFiles.file("reports", file.id)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = true
        }
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
        local?.let { f ->
            NxButton(
                t("reports.openFile"),
                { openEvidence(f, file.mime, file.name) },
                kind = ButtonKind.SECONDARY,
            )
        }
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
                                if (mime.startsWith("image/")) "png" else "mp4",
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
