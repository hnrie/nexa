package fish.nexa.ui.moderation

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.BugMessage
import fish.nexa.data.Ids
import fish.nexa.data.ModEvent
import fish.nexa.data.Moderation
import fish.nexa.data.NexaFile
import fish.nexa.data.PrivateFiles
import fish.nexa.data.StaffBug
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.nexa.BugStatusChip
import fish.nexa.ui.nexa.LockNote
import fish.nexa.ui.nexa.ReportOpener
import fish.nexa.ui.nexa.ThreadChat
import fish.nexa.ui.nexa.ThreadIntro
import fish.nexa.ui.nexa.ThreadOpener
import fish.nexa.ui.nexa.UnreadDot
import fish.nexa.ui.nexa.bugNumber
import fish.nexa.ui.nexa.bugStatusLabel
import fish.nexa.ui.nexa.line
import fish.nexa.ui.nexa.systemLineText
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PAGE = 40
private val BUG_STATUSES = listOf("open", "in_progress", "resolved", "wont_fix", "closed")

/** Resolved, Won't Fix and Closed: finished, and closed to everyone until staff open it again. */
fun bugFinished(status: String) = status == "resolved" || status == "wont_fix" || status == "closed"

/** Whether a report belongs in a view of the list. */
private fun inView(r: StaffBug, view: String, files: Boolean): Boolean {
    if (files && r.attachments.isEmpty()) return false
    return when (view) {
        "waiting" -> r.awaiting == "staff"
        "active" -> r.status == "open" || r.status == "in_progress"
        "all" -> true
        else -> r.status == view
    }
}

private fun order(sort: String): Comparator<StaffBug> = when (sort) {
    "newest" -> Comparator { a, z -> Ids.compare(z.id, a.id) }
    "oldest" -> Comparator { a, z -> Ids.compare(a.id, z.id) }
    else -> Comparator { a, z -> if (z.lastActivityAt != a.lastActivityAt) z.lastActivityAt.compareTo(a.lastActivityAt) else Ids.compare(z.id, a.id) }
}

/** The newest line of a report's thread, as the list previews it. */
private fun preview(r: StaffBug, whoName: String? = null): String {
    val last = r.lastMessage ?: return Markdown.plainText(Markdown.parse(r.description), fish.nexa.ui.chat.AppNames)
    if (last.kind == "system") return systemLineText(last.line(), null, staff = true, whoName = whoName)
    val p = fish.nexa.data.NexaInbox.people.value[last.authorId]
    val who = whoName ?: if (p != null) nameOf(p) else r.reporterDisplayName
    return "$who: " + Markdown.plainText(Markdown.parse(last.body), fish.nexa.ui.chat.AppNames)
}

/**
 * The Bug Reports tab (BugsTab.tsx): every report members sent, in the view
 * picked, with the one chosen open in its place on a phone: the report in
 * full, its files, the device it came from, and the thread with its
 * reporter, where staff answer as Nexa and move it along.
 */
@Composable
fun BugsTab(reportId: String?) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf("waiting") }
    var files by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var q by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("activity") }
    val reports = remember { mutableStateListOf<StaffBug>() }
    var loaded by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val counts by Moderation.bugCounts.collectAsState()

    // the search waits for a pause in typing
    LaunchedEffect(query) {
        delay(250)
        q = query.trim()
    }
    // only the newest request may fill the list: a slower answer for the filters picked before would land in this one
    var request by remember { mutableStateOf(0) }
    fun load(after: StaffBug? = null) {
        val id = ++request
        loading = true
        failed = false
        scope.launch {
            try {
                val r = Moderation.bugs(view, files, q, sort, after, PAGE)
                if (id != request) return@launch
                if (after == null) reports.clear()
                reports.addAll(r.reports.filter { x -> reports.none { it.id == x.id } })
                more = r.more
                loaded = true
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                if (id == request) failed = true
            } finally {
                if (id == request) loading = false
            }
        }
    }
    LaunchedEffect(view, files, q, sort) {
        loaded = false
        reports.clear()
        load()
    }
    fun upsert(r: StaffBug) {
        val had = reports.any { it.id == r.id }
        val rest = reports.filter { it.id != r.id }
        // a search is the server's to answer; a report that moves only updates where it is already listed
        val keep = if (q.isNotEmpty()) had else inView(r, view, files) || r.id == reportId
        val next = if (keep) (listOf(r) + rest).sortedWith(order(sort)) else rest
        reports.clear()
        reports.addAll(next)
    }
    LaunchedEffect(Unit) { Moderation.events.collect { e -> if (e is ModEvent.Bug && loaded) upsert(e.report) } }

    if (reportId != null) {
        StaffBugPane(reportId, onBack = { goPanel("bugs", replace = true) }) { upsert(it) }
        return
    }
    val views = listOf(
        "waiting" to (t("bugs.staff.viewWaiting") to counts?.waiting),
        "open" to (bugStatusLabel("open") to counts?.open),
        "in_progress" to (bugStatusLabel("in_progress") to counts?.inProgress),
        "resolved" to (bugStatusLabel("resolved") to counts?.resolved),
        "wont_fix" to (bugStatusLabel("wont_fix") to counts?.wontFix),
        "closed" to (bugStatusLabel("closed") to counts?.closed),
        "all" to (t("bugs.staff.viewAll") to counts?.all),
    )
    val filtered = q.isNotEmpty() || files
    Column(Modifier.fillMaxSize().background(c.bgBase)) {
        Column(
            Modifier.fillMaxWidth().drawBehind { drawRect(c.borderSubtle, Offset(0f, size.height - 1.dp.toPx()), Size(size.width, 1.dp.toPx())) }.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                SearchField(query, { query = it }, t("bugs.staff.searchShort"), Modifier.weight(1f))
                fish.nexa.ui.components.SelectField(
                    null,
                    listOf("activity" to t("bugs.staff.sortActivity"), "newest" to t("bugs.staff.sortNewest"), "oldest" to t("bugs.staff.sortOldest")),
                    sort, Modifier.fillMaxWidth(0.45f),
                ) { sort = it }
            }
            ChipRow(t("bugs.staff.views")) {
                for ((id, pair) in views) ModChip(pair.first, view == id, { view = id }, count = pair.second, small = true)
                ModChip(t("bugs.staff.withFiles"), files, { files = !files }, icon = "Paperclip", small = true, pressedStyle = true)
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(6.dp)) {
            when {
                failed && reports.isEmpty() -> item("failed") { LoadFailed({ load() }, loading) }
                !loaded -> item("loading") { LoadingRow() }
                reports.isEmpty() -> item("empty") {
                    EmptyState("Inbox", if (filtered) t("bugs.staff.noMatches") else if (view == "waiting") t("bugs.staff.caughtUp") else t("bugs.staff.none")) {
                        if (filtered) NxButton(t("moderation.clearFilters"), { query = ""; q = ""; files = false }, kind = ButtonKind.GHOST, size = ButtonSize.TOUCH)
                    }
                }
                else -> {
                    items(reports, key = { it.id }) { r -> BugRow(r) { goPanel("bugs/${r.id}") } }
                    if (more) item("more") {
                        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                            NxButton(t("moderation.loadMore"), { load(reports.lastOrNull()) }, kind = ButtonKind.GHOST, size = ButtonSize.TOUCH, loading = loading)
                        }
                    }
                }
            }
        }
    }
}

/**
 * One report in the list: its number and subject, who sent it (a way to
 * their profile), whether it waits on staff and where it stands, the start of
 * what it says, and its files.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BugRow(r: StaffBug, onPick: () -> Unit) {
    val c = Nx.colors
    val fresh = Moderation.unread.collectAsState().value.bugs.contains(r.id)
    val who = person(r.userId)
    val name = who?.let { nameOf(it) } ?: r.reporterDisplayName.ifEmpty { r.reporterUsername }
    val gone = who == null || who.deleted
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Sm
    Row(
        Modifier.fillMaxWidth().background(pressTint(pressed), shape).clip(shape).pressable(interaction, onClick = onPick).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.clip(CircleShape).pressable(remember { MutableInteractionSource() }, enabled = !gone) { openProfile(r.userId) }) { Avatar(r.userId, name, who?.avatarId, 36.dp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(bugNumber(r.number), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(600), fontFeatureSettings = "tnum"), color = c.textMuted, maxLines = 1)
                Txt(r.subject, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(if (fresh) 750 else if (r.awaiting == "staff") 700 else 600)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f))
                if (fresh) UnreadDot()
                Txt(Time.relative(r.lastActivityAt), style = Nx.type.hint, color = c.textMuted, maxLines = 1)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                fish.nexa.ui.chat.PersonName(
                    r.userId.takeUnless { gone }, name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(500)), color = c.textSubtle, maxLines = 1,
                    modifier = Modifier.clip(Radii.Xs).pressable(remember { MutableInteractionSource() }, enabled = !gone) { openProfile(r.userId) }.semantics { contentDescription = t("nexa.viewProfile") + ", " + name },
                )
                if (r.awaiting == "staff") Tag(t("bugs.staff.waiting"), "danger")
                BugStatusChip(r.status, small = true)
            }
            fish.nexa.ui.chat.PersonText(r.lastMessage?.authorId, preview(r, fish.nexa.ui.chat.PERSON_SLOT), r.lastMessage?.authorId?.let { fish.nexa.ui.nexa.personName(fish.nexa.ui.nexa.threadPerson(it)) } ?: "", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.textSubtle, maxLines = 2)
            if (r.attachments.isNotEmpty()) Box(Modifier.padding(top = 4.dp)) { ThumbStrip(r.attachments) }
        }
    }
}

/** A report's files in a list row: a few small squares and how many more. */
@Composable
private fun ThumbStrip(files: List<NexaFile>, max: Int = 3) {
    val c = Nx.colors
    val shown = files.take(max)
    val shape = RoundedCornerShape(6.dp)
    Row(Modifier.semantics { contentDescription = t("bugs.card.files", "count" to files.size) }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (f in shown) {
            val video = f.mime.startsWith("video/")
            Box(
                Modifier.size(32.dp).clip(shape).background(if (video) c.brand.copy(alpha = 0.12f) else c.bgActive).border(1.dp, c.borderSubtle, shape),
                contentAlignment = Alignment.Center,
            ) {
                if (video) Icon("Play", c.textBrand, size = 12.dp)
                else {
                    var file by remember(f.id) { mutableStateOf<java.io.File?>(null) }
                    LaunchedEffect(f.id) { file = runCatching { PrivateFiles.file("bugs", f.id, 64) }.getOrNull() }
                    file?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
                }
            }
        }
        if (files.size > max) Box(Modifier.size(32.dp).clip(shape).background(c.bgActive).border(1.dp, c.borderSubtle, shape), contentAlignment = Alignment.Center) {
            Txt("+${files.size - max}", style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f), fontWeight = FontWeight(700), fontFeatureSettings = "tnum"), color = c.text)
        }
    }
}

/**
 * A report for the staff (StaffBugPane): the report in full, its thread, and
 * what can be done about it: answer as Nexa, move it to another status, or
 * mark it resolved in one step.
 */
@Composable
private fun StaffBugPane(reportId: String, onBack: () -> Unit, onChanged: (StaffBug) -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var report by remember(reportId) { mutableStateOf<StaffBug?>(null) }
    val messages = remember(reportId) { mutableStateListOf<BugMessage>() }
    var failed by remember(reportId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    fun merge(lines: List<BugMessage>) {
        val seen = messages.mapTo(HashSet()) { it.id }
        val add = lines.filter { it.id !in seen }
        if (add.isEmpty()) return
        val all = (messages + add).sortedWith { a, b -> Ids.compare(a.id, b.id) }
        messages.clear()
        messages.addAll(all)
    }
    fun apply(r: StaffBug, lines: List<BugMessage> = emptyList()) {
        report = r
        merge(lines)
        onChanged(r)
    }
    LaunchedEffect(reportId) {
        try {
            val r = Moderation.bugThread(reportId)
            report = r.report
            messages.clear()
            messages.addAll(r.messages)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            failed = true
        }
    }
    LaunchedEffect(reportId) {
        Moderation.events.collect { e -> if (e is ModEvent.Bug && e.report.id == reportId && report != null) { report = e.report; merge(e.messages) } }
    }
    fun setStatus(status: String) {
        val r = report ?: return
        if (status == r.status) return
        busy = true
        Nexa.scope.launch {
            try {
                val res = Moderation.setBugStatus(reportId, status)
                apply(res.report, res.messages)
                Nexa.ui.toast(t("bugs.staff.statusSet", "status" to bugStatusLabel(status)), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("moderation.failed")), "error")
            } finally {
                busy = false
            }
        }
    }

    val r = report
    if (failed) {
        EmptyState(null, null, t("bugs.staff.missing")) { NxButton(t("moderation.back"), onBack, kind = ButtonKind.SECONDARY, size = ButtonSize.SM) }
        return
    }
    if (r == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(size = 28.dp) }
        return
    }
    val reporter = person(r.userId)
    val gone = reporter == null || reporter.deleted
    val reporterName = reporter?.let { nameOf(it) } ?: r.reporterDisplayName.ifEmpty { r.reporterUsername }
    val finished = bugFinished(r.status)
    Column(Modifier.fillMaxSize()) {
        // on a phone the header takes two rows: what it is, then what can be done about it
        PaneHeader(
            onBack,
            wrap = true,
            title = {
                Box(Modifier.size(28.dp).background(c.brand.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) { Icon("Bug", c.textBrand, size = 16.dp) }
                PaneTitle(bugNumber(r.number) + " " + r.subject)
            },
        ) {
            NxButton(
                t("bugs.staff.statusIs", "status" to bugStatusLabel(r.status)),
                { openMenu(BUG_STATUSES.map { st -> MenuItem.Action(bugStatusLabel(st), checked = st == r.status) { setStatus(st) } }, title = t("bugs.staff.setStatus")) },
                kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH, enabled = !busy,
                trailing = { Icon("ChevronDown", c.text, size = 14.dp) },
            )
            if (finished) NxButton(t("bugs.staff.reopen"), { setStatus("open") }, kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH, icon = "RotateCcw", enabled = !busy)
            else NxButton(t("bugs.staff.markResolved"), { setStatus("resolved") }, kind = ButtonKind.POSITIVE, size = ButtonSize.TOUCH, icon = "CircleCheck", enabled = !busy)
            if (!gone) ModIconButton("UserRound", t("moderation.case.openPerson", "name" to reporterName), { goPanel("users/${r.userId}") })
        }
        ThreadChat(
            lines = messages.map { it.line() },
            staff = true,
            fileKind = "bugs",
            placeholder = t("bugs.thread.staffPlaceholder"),
            intro = {
                ThreadIntro(
                    { Avatar(r.userId, reporterName, reporter?.avatarId, 80.dp) },
                    t("bugs.page.title", "number" to bugNumber(r.number)),
                    r.subject,
                    t("moderation.chat.reportStart", "name" to reporterName),
                )
            },
            opener = ThreadOpener(r.userId, r.createdAt) { ReportOpener(r.subject, r.description, r.attachments, r.context, reporterName) },
            onSend = if (gone || finished) null else ({ body, fs ->
                val res = Moderation.bugReply(reportId, body, fs)
                apply(res.report, res.messages)
            }),
            uploadPath = "/moderation/bugs/attachments",
            locked = if (gone) ({ LockNote(t("moderation.case.goneNote")) }) else ({
                LockNote(t("bugs.staff.finishedLocked", "status" to bugStatusLabel(r.status))) {
                    NxButton(t("bugs.staff.reopen"), { setStatus("open") }, kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH, icon = "RotateCcw", enabled = !busy)
                }
            }),
            note = {
                fish.nexa.ui.chat.PersonText(r.userId, t("moderation.case.replyNote", "name" to fish.nexa.ui.chat.PERSON_SLOT), nameOf(reporter), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17.5f)), color = c.textMuted)
            },
            onSeen = { last -> Moderation.readThread("bug", reportId, last) },
        )
    }
}
