package fish.nexa.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import fish.nexa.notes.NoteLinkRow
import fish.nexa.notes.NoteRole
import fish.nexa.notes.NoteShare
import fish.nexa.notes.NoteSharing
import fish.nexa.notes.Notes
import fish.nexa.notes.NotesApi
import fish.nexa.notes.NoteModel
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.server.Loading
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer

private fun roleName(role: Int): String = when (role) {
    NoteRole.OWNER -> t("notes.share.owner")
    NoteRole.EDITOR -> t("notes.share.canEdit")
    else -> t("notes.share.canView")
}

private fun nameOf(u: PublicUser) = u.displayName.ifEmpty { u.username }

/** How many people the search shows at once. */
private const val SHOWN = 8

/**
 * Who a note is shared with, and sharing it further (ShareNoteModal.tsx).
 * Its owner asks people in, each of whom gets a request to accept, makes
 * links that let anyone who has one join, and changes or takes away what
 * people may do. Everyone else sees who has the note, and can leave it.
 */
fun openShareNote(noteId: String) {
    val item = Notes.notes.value[noteId]
    val title = NoteModel.name(item?.head?.title)
    val owner = item?.role == NoteRole.OWNER
    openSheet("share-note", title = if (owner) t("notes.share.title", "title" to title) else t("notes.share.whoTitle", "title" to title)) { close ->
        ShareNoteBody(noteId, close)
    }
}

@Composable
private fun ShareNoteBody(noteId: String, close: () -> Unit) {
    val c = Nx.colors
    val notes by Notes.notes.collectAsState()
    val status by Notes.status.collectAsState()
    val changes by Notes.sharing.collectAsState()
    val item = notes[noteId]
    val changed = changes[noteId] ?: 0
    val meId = Nexa.users.meId
    val owner = item?.role == NoteRole.OWNER
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf<NoteSharing?>(null) }
    var failed by remember { mutableStateOf<Throwable?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(noteId, changed, attempt) {
        failed = null
        try {
            val got = NotesApi.sharing(noteId)
            sharing = got
            Nexa.users.upsert(got.members.map { it.user } + got.invites.map { it.user })
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = e
        }
    }
    val reload = { attempt += 1 }
    // the note went (deleted, or this account taken out of it): nothing left to share
    LaunchedEffect(item, status) { if (status == Notes.Status.READY && item == null) close() }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        failed?.let { err ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Txt(NoteShare.error(err, t("notes.share.couldNotLoad")), style = Nx.type.bodySmall, color = c.textMuted)
                NxButton(t("notes.page.tryAgain"), reload, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
            }
        }
        val s = sharing
        if (s == null && failed == null) Loading(t("notes.share.loading"))
        if (s != null) {
            if (owner) InvitePeople(noteId, s, reload)
            PeopleWithAccess(noteId, s, owner, meId, reload)
            if (owner) ShareLinks(noteId, s.links, reload)
            if (owner) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon("KeyRound", c.positive, size = 16.dp, modifier = Modifier.padding(top = 2.dp))
                    Txt(t("notes.share.keyNote"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.85f)), color = c.textMuted)
                }
            }
            if (!owner && item != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    NxButton(t("notes.menu.leave"), {
                        scope.launch {
                            try {
                                NoteShare.remove(item)
                                close()
                                Nav.go(Route.Notes())
                            } catch (e: Exception) {
                                Nexa.ui.toast(NoteShare.error(e), "error")
                            }
                        }
                    }, kind = ButtonKind.DANGER)
                }
            }
        }
    }
}

@Composable
private fun SectionHeading(text: String) = Txt(
    text,
    style = Nx.type.label.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(700)),
    color = Nx.colors.textSubtle,
    modifier = Modifier.semantics { heading() },
)

@Composable
private fun Hint(text: String) = Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = Nx.colors.textMuted)

/** One person in a list (.person): their face, their name and username, and what is done with them. */
@Composable
private fun PersonRow(user: PublicUser, label: String, sub: String, trailing: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(user.id, nameOf(user), user.avatarId, 32.dp)
        Column(Modifier.weight(1f)) {
            Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(600), lineHeight = Nx.type.sp(19.4f)), color = Nx.colors.text, maxLines = 1)
            Txt(sub, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(16.25f)), color = Nx.colors.textMuted, maxLines = 1)
        }
        trailing()
    }
}

/** A choice of two, as one control (.roles): what someone asked in may do. */
@Composable
private fun RoleChoice(role: Int, onPick: (Int) -> Unit) {
    val c = Nx.colors
    val outer = RoundedCornerShape(11.dp)
    Row(
        Modifier.sunken(outer, c).ring(outer, c.borderSubtle).padding(3.dp).semantics { contentDescription = t("notes.share.inviteAs") },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (r in listOf(NoteRole.EDITOR, NoteRole.VIEWER)) {
            val on = role == r
            val shape = RoundedCornerShape(8.dp)
            Box(
                Modifier
                    .height(36.dp)
                    .then(if (on) Modifier.shadowLow(shape, c).ring(shape, c.borderSubtle).background(c.bgSurface, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight) else Modifier)
                    .clip(shape)
                    .pressable(remember { MutableInteractionSource() }, role = Role.RadioButton) { onPick(r) }
                    .padding(horizontal = 12.dp)
                    .semantics { selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Txt(
                    if (r == NoteRole.EDITOR) t("notes.share.canEdit") else t("notes.share.canView"),
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(600)),
                    color = if (on) c.textStrong else c.textMuted,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun InvitePeople(noteId: String, sharing: NoteSharing, onDone: () -> Unit) {
    val rels by Nexa.relationships.byId.collectAsState()
    val meId = Nexa.users.meId
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var role by remember { mutableIntStateOf(NoteRole.EDITOR) }
    val found = remember { mutableStateListOf<PublicUser>() }
    var busy by remember { mutableStateOf<String?>(null) }
    val sent = remember { mutableStateListOf<String>() }
    // anyone by their username: the server's search, a moment after the typing stops
    LaunchedEffect(q) {
        val query = q.trim().removePrefix("@")
        if (query.length < 2) {
            found.clear()
            return@LaunchedEffect
        }
        delay(250)
        try {
            val res = Nexa.api.get("/users/search?q=${java.net.URLEncoder.encode(query, "UTF-8")}")
            val list = wireJson.decodeFromJsonElement(ListSerializer(PublicUser.serializer()), res)
            found.clear()
            found.addAll(list)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }
    val taken = remember(sharing, meId) { (sharing.members.map { it.user.id } + sharing.invites.map { it.user.id } + listOfNotNull(meId)).toSet() }
    val query = q.trim().removePrefix("@").lowercase()
    val people = run {
        val friends = rels.values.filter { it.type == "friend" }.map { it.user }
            .filter { query.isEmpty() || it.username.lowercase().contains(query) || it.displayName.lowercase().contains(query) }
        val out = ArrayList<PublicUser>()
        val seen = HashSet<String>()
        // friends first, then whoever the search found
        for (u in friends + found) {
            if (!seen.add(u.id) || (u.id in taken && u.id !in sent)) continue
            out += u
        }
        out.take(SHOWN)
    }
    fun invite(u: PublicUser) {
        if (busy != null) return
        busy = u.id
        scope.launch {
            try {
                NoteShare.invite(noteId, u, role)
                sent += u.id
                Nexa.ui.toast(t("notes.share.invited", "name" to nameOf(u)), "success")
                onDone()
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.share.couldNotInvite", "name" to nameOf(u))), "error")
            } finally {
                busy = null
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeading(t("notes.share.invitePeople"))
        NxTextField(q, { q = it }, placeholder = t("notes.share.searchPlaceholder"), modifier = Modifier.fillMaxWidth())
        RoleChoice(role) { role = it }
        if (people.isNotEmpty()) {
            Column {
                for (u in people) {
                    val done = u.id in sent
                    PersonRow(u, nameOf(u), u.username) {
                        NxButton(
                            if (done) t("notes.share.invitedShort") else t("notes.share.invite"),
                            { invite(u) },
                            kind = if (done) ButtonKind.SECONDARY else ButtonKind.PRIMARY,
                            size = ButtonSize.SM,
                            icon = if (done) "Check" else "UserPlus",
                            enabled = !done,
                            loading = busy == u.id,
                            modifier = Modifier.semantics { contentDescription = if (done) t("notes.share.invitedShort") else t("notes.share.inviteNamed", "name" to nameOf(u)) },
                        )
                    }
                }
            }
        } else Hint(if (q.trim().length >= 2) t("notes.share.nobodyFound") else t("notes.share.inviteHint"))
    }
}

@Composable
private fun PeopleWithAccess(noteId: String, sharing: NoteSharing, owner: Boolean, meId: String?, onDone: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    fun act(key: String, fail: String, run: suspend () -> Unit) {
        if (busy != null) return
        busy = key
        scope.launch {
            try {
                run()
                onDone()
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, fail), "error")
            } finally {
                busy = null
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeading(t("notes.share.peopleWithAccess"))
        Column {
            for (m in sharing.members) {
                val name = nameOf(m.user)
                val mine = m.user.id == meId
                PersonRow(m.user, if (mine) t("notes.share.you", "name" to name) else name, m.user.username) {
                    if (owner && m.role != NoteRole.OWNER) {
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        Row(
                            Modifier
                                .height(40.dp)
                                .clip(Radii.Sm)
                                .background(if (pressed) c.bgHover else Color.Transparent)
                                .alpha(if (busy != null) 0.6f else 1f)
                                .pressable(interaction, enabled = busy == null) {
                                    val setRole = { r: Int -> act("role" + m.user.id, t("notes.share.couldNotChange", "name" to name)) { NotesApi.setRole(noteId, m.user.id, r) } }
                                    openMenu(
                                        listOf(
                                            MenuItem.Action(t("notes.share.canEdit"), checked = m.role == NoteRole.EDITOR) { if (m.role != NoteRole.EDITOR) setRole(NoteRole.EDITOR) },
                                            MenuItem.Action(t("notes.share.canView"), checked = m.role == NoteRole.VIEWER, separatorAfter = true) { if (m.role != NoteRole.VIEWER) setRole(NoteRole.VIEWER) },
                                            MenuItem.Action(t("notes.share.removeFromNote"), danger = true) {
                                                act("rm" + m.user.id, t("notes.share.couldNotRemove", "name" to name)) { NotesApi.removeMember(noteId, m.user.id) }
                                            },
                                        ),
                                        title = t("notes.share.roleOf", "name" to name),
                                    )
                                }
                                .padding(start = 11.dp, end = 8.dp)
                                .semantics { contentDescription = t("notes.share.roleOf", "name" to name) },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Txt(roleName(m.role), style = Nx.type.label.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(600)), color = if (pressed) c.textStrong else c.textSubtle, maxLines = 1)
                            Icon("ChevronDown", if (pressed) c.textStrong else c.textSubtle, size = 15.dp)
                        }
                    } else RoleTag(roleName(m.role))
                }
            }
            for (inv in sharing.invites) {
                val name = nameOf(inv.user)
                PersonRow(inv.user, name, t("notes.share.waiting", "role" to roleName(inv.role))) {
                    if (owner) NxButton(
                        t("notes.share.cancelInvite"),
                        { act("inv" + inv.id, t("notes.share.couldNotCancel")) { NotesApi.cancelInvite(noteId, inv.id) } },
                        kind = ButtonKind.GHOST,
                        size = ButtonSize.SM,
                        enabled = busy == null,
                        loading = busy == "inv" + inv.id,
                    )
                }
            }
        }
    }
}

/** What someone may do, as a tag (.roleTag), where it cannot be changed from here. */
@Composable
private fun RoleTag(text: String) {
    Box(Modifier.height(26.dp).background(Nx.colors.bgActive, RoundedCornerShape(50)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Txt(text, style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(600)), color = Nx.colors.textSubtle, maxLines = 1)
    }
}

@Composable
private fun ShareLinks(noteId: String, links: List<NoteLinkRow>, onDone: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    val addresses = remember { mutableStateMapOf<String, String?>() }
    var copied by remember { mutableStateOf<String?>(null) }
    // each link's address is kept sealed with the note's key, and opened here to be copied again
    val ids = links.joinToString(",") { it.id }
    LaunchedEffect(noteId, ids) {
        for (l in links) if (l.id !in addresses) addresses[l.id] = NoteShare.linkAddress(noteId, l)
    }
    fun copy(id: String, url: String) {
        fish.nexa.ui.profile.copyWithToast(url, t("notes.share.linkCopied"))
        copied = id
        scope.launch {
            delay(2000)
            if (copied == id) copied = null
        }
    }
    fun create(role: Int) {
        if (busy != null) return
        busy = "new"
        scope.launch {
            try {
                val (row, url) = NoteShare.createLink(noteId, role)
                addresses[row.id] = url
                copy(row.id, url)
                onDone()
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.share.couldNotMakeLink")), "error")
            } finally {
                busy = null
            }
        }
    }
    fun remove(id: String) {
        if (busy != null) return
        busy = id
        scope.launch {
            try {
                NotesApi.removeLink(noteId, id)
                onDone()
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.share.couldNotRemoveLink")), "error")
            } finally {
                busy = null
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeading(t("notes.share.links"))
        if (links.isNotEmpty()) {
            Column {
                for (l in links) {
                    val url = addresses[l.id]
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Box(Modifier.size(32.dp).background(c.bgActive, CircleShape), contentAlignment = Alignment.Center) { Icon("Link2", c.textSubtle, size = 18.dp) }
                        Column(Modifier.weight(1f)) {
                            Txt(
                                if (l.role == NoteRole.EDITOR) t("notes.share.linkCanEdit") else t("notes.share.linkCanView"),
                                style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(600), lineHeight = Nx.type.sp(19.4f)),
                                color = c.text,
                                maxLines = 2,
                            )
                            Txt(t("notes.share.linkUses", "count" to l.uses), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                        }
                        if (url != null) NxButton(
                            if (copied == l.id) t("notes.share.copied") else t("notes.share.copy"),
                            { copy(l.id, url) },
                            kind = if (copied == l.id) ButtonKind.POSITIVE else ButtonKind.SECONDARY,
                            size = ButtonSize.SM,
                            icon = if (copied == l.id) "Check" else "Copy",
                        )
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(Radii.Sm)
                                .background(if (pressed) c.bgHover else Color.Transparent)
                                .alpha(if (busy != null) 0.5f else 1f)
                                .pressable(interaction, enabled = busy == null) { remove(l.id) }
                                .semantics { contentDescription = t("notes.share.removeLink") },
                            contentAlignment = Alignment.Center,
                        ) { Icon("Trash2", if (pressed) c.textStrong else c.textMuted, size = 16.dp) }
                    }
                }
            }
        } else Hint(t("notes.share.linksHint"))
        Box {
            NxButton(
                t("notes.share.createLink"),
                {
                    openMenu(
                        listOf(
                            MenuItem.Action(t("notes.share.linkCanView")) { create(NoteRole.VIEWER) },
                            MenuItem.Action(t("notes.share.linkCanEdit")) { create(NoteRole.EDITOR) },
                        ),
                        title = t("notes.share.linkRole"),
                    )
                },
                kind = ButtonKind.SECONDARY,
                icon = "Plus",
                loading = busy == "new",
            )
        }
    }
}
