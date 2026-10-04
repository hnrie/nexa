package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.Invites
import fish.nexa.media.Media
import fish.nexa.net.ApiError
import fish.nexa.net.MeUser
import fish.nexa.net.WornTag
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.AnchorRef
import fish.nexa.ui.layers.anchor
import fish.nexa.ui.layers.openPopout
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** The 30 badges a tag may wear (lib/serverTags.ts TAG_ICONS), by their Lucide names. */
private val TAG_ICONS = setOf(
    "leaf", "flame", "heart", "star", "sparkles", "zap", "moon", "sun", "snowflake", "droplet", "cloud", "rainbow",
    "skull", "ghost", "crown", "gem", "swords", "shield", "cat", "dog", "bird", "fish", "rabbit", "paw-print",
    "rocket", "music", "gamepad-2", "trophy", "coffee", "cherry",
)

private data class ChipSize(val height: Int, val text: Float, val padStart: Int, val padEnd: Int, val radius: Int, val gap: Int, val badge: Int)

private val SIZES = mapOf(
    "sm" to ChipSize(16, 10.5f, 3, 5, 5, 3, 10),
    "md" to ChipSize(18, 11f, 4, 6, 6, 3, 12),
    "lg" to ChipSize(24, 13.5f, 6, 9, 8, 5, 18),
)

/** A tag's badge: an uploaded picture or one of the icons, in a tint of the tag's colour. */
@Composable
private fun TagBadge(badge: String, size: Int, tint: androidx.compose.ui.graphics.Color, px: Int) {
    val density = LocalDensity.current.density
    val image = Regex("^image:(\\d{1,20})$").find(badge)?.groupValues?.get(1)
    var failed by remember(badge) { mutableStateOf(false) }
    if (image != null && !failed) {
        AsyncImage(Media.tagUrl(image, px, density), null, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.size(size.dp).clip(RoundedCornerShape(3.dp)), onError = { failed = true })
        return
    }
    val name = badge.removePrefix("icon:").takeIf { badge.startsWith("icon:") && it in TAG_ICONS } ?: "sparkles"
    Icon(name, tint, size = size.dp, stroke = 2.4f)
}

/**
 * ServerTagChip: the tag a person wears beside their name, in the tag's own
 * colour mixed toward the theme so it reads on every panel. With `open` (a
 * message's author, a profile) a tap shows the server it is from and what can
 * be done: wear it, go there, or join. In a list it is only a label: a tap
 * there is meant for the row, and one that landed on the tag would open
 * something else.
 */
@Composable
fun ServerTagChip(tag: WornTag, small: Boolean = false, size: String = if (small) "sm" else "md", open: Boolean = false) {
    val c = Nx.colors
    val s = SIZES.getValue(size)
    val color = tag.color?.let { rgbColor(it) } ?: c.brand
    val shape = RoundedCornerShape(s.radius.dp)
    val ref = remember { AnchorRef() }
    val label = t("serverTag.chipLabel", "tag" to tag.text)
    Row(
        Modifier
            .anchor(ref)
            // as tall as its words when the phone's text is set large
            .heightIn(min = s.height.dp)
            .ring(shape, color.copy(alpha = 0.42f), 1.dp)
            .background(color.copy(alpha = 0.20f), shape)
            .then(if (open && tag.serverId.isNotEmpty()) Modifier.pressable(remember { MutableInteractionSource() }) { openTagPopout(tag, ref) } else Modifier)
            .semantics { contentDescription = label }
            .padding(start = s.padStart.dp, end = s.padEnd.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(s.gap.dp),
    ) {
        TagBadge(tag.badge.ifEmpty { "icon:sparkles" }, s.height - 6, mixOklab(color, c.textStrong, 0.18f), s.badge)
        Txt(
            tag.text,
            style = Nx.type.hint.copy(fontSize = Nx.type.sp(s.text), fontWeight = FontWeight(700), letterSpacing = 0.01.em, fontFeatureSettings = "tnum"),
            color = mixOklab(color, c.textStrong, 0.40f), maxLines = 1,
        )
    }
}

/** What GET /server-tags/{id} says about a tag's server, and what this person may do with it. */
private data class TagPreview(val target: InviteTarget, val tag: WornTag, val member: Boolean, val canWear: Boolean?, val invite: String?)

private val previews = HashMap<String, Pair<Long, TagPreview?>>()

private suspend fun loadPreview(id: String, fresh: Boolean = false): TagPreview? {
    synchronized(previews) { previews[id]?.let { (at, p) -> if (!fresh && System.currentTimeMillis() - at < 60_000) return p } }
    val p = runCatching {
        val o = Nexa.api.get("/server-tags/$id") as JsonObject
        val sv = o["server"] as JsonObject
        val tg = o["tag"] as JsonObject
        fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
        TagPreview(
            InviteTarget("server", sv.s("id"), sv.s("name") ?: "", sv.s("description") ?: "", sv.s("icon_id"), sv.s("banner_id"),
                (sv["online_count"] as? JsonPrimitive)?.intOrNull, (sv["member_count"] as? JsonPrimitive)?.intOrNull),
            WornTag(id, tg.s("text") ?: "", tg.s("badge") ?: "", (tg["color"] as? JsonPrimitive)?.longOrNull),
            (o["member"] as? JsonPrimitive)?.booleanOrNull == true,
            (o["can_wear"] as? JsonPrimitive)?.booleanOrNull,
            o.s("invite"),
        )
    }.getOrNull()
    synchronized(previews) { if (p != null) previews[id] = System.currentTimeMillis() to p else previews.remove(id) }
    return p
}

private fun openTagPopout(tag: WornTag, ref: AnchorRef) {
    openPopout("server-tag", ref.rect, 340.dp) { close ->
        val c = Nx.colors
        val scope = rememberCoroutineScope()
        var preview by remember { mutableStateOf<TagPreview?>(null) }
        var loaded by remember { mutableStateOf(false) }
        var busy by remember { mutableStateOf(false) }
        val me by Nexa.users.me.collectAsState()
        LaunchedEffect(Unit) {
            preview = loadPreview(tag.serverId)
            loaded = true
        }
        val wearing = me?.serverTag?.serverId == tag.serverId
        fun wear(on: Boolean) {
            busy = true
            scope.launch {
                try {
                    val res = if (on) Nexa.api.request("PUT", "/users/@me/server-tag", kotlinx.serialization.json.buildJsonObject { put("server_id", JsonPrimitive(tag.serverId)) })
                    else Nexa.api.request("DELETE", "/users/@me/server-tag")
                    Nexa.users.setMe(wireJson.decodeFromJsonElement(MeUser.serializer(), res))
                    Nexa.ui.toast(if (on) t("serverTag.nowWearing", "tag" to tag.text) else t("serverTag.tookOff"), "success")
                } catch (e: Exception) {
                    Nexa.ui.toast((e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: t("serverTag.couldNotChange"), "error")
                } finally {
                    busy = false
                }
            }
        }
        Box(Modifier.width(340.dp).semantics { contentDescription = t("serverTag.popoutLabel", "tag" to tag.text) }) {
            val p = preview
            when {
                !loaded -> Box(Modifier.fillMaxWidth().padding(vertical = 28.dp), contentAlignment = Alignment.Center) { Spinner(size = 22.dp) }
                p == null -> Txt(t("serverTag.gone"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, modifier = Modifier.padding(16.dp))
                else -> InviteCardView(
                    p.target,
                    lead = { ServerTagChip(p.tag, size = "lg") },
                    action = {
                        when {
                            p.member && p.canWear != false && !wearing -> NxButton(t("serverTag.wear"), { wear(true) }, size = ButtonSize.SM, loading = busy)
                            p.member -> NxButton(t("serverTag.goToServer"), { close(); Nav.go(Route.Server(tag.serverId)) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                            p.invite != null -> NxButton(t("invite.joinServer"), {
                                busy = true
                                scope.launch {
                                    try {
                                        val route = Invites.accept(p.invite, "")
                                        close()
                                        Nav.go(route)
                                    } catch (e: Exception) {
                                        Nexa.ui.toast((e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: t("serverTag.couldNotChange"), "error")
                                    } finally {
                                        busy = false
                                    }
                                }
                            }, kind = ButtonKind.POSITIVE, size = ButtonSize.SM, loading = busy)
                        }
                    },
                    inPopout = true,
                    extra = {
                        val note = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f))
                        when {
                            wearing -> FlowRow(Modifier.padding(top = 12.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Txt(t("serverTag.youWearIt"), style = note, color = c.textMuted)
                                Txt(t("serverTag.takeOff"), style = note.copy(fontWeight = FontWeight(600)), color = c.link,
                                    modifier = Modifier.pressable(remember { MutableInteractionSource() }, enabled = !busy) { wear(false) })
                            }
                            !p.member && p.invite == null -> Txt(t("serverTag.notJoinable"), style = note, color = c.textMuted, modifier = Modifier.padding(top = 12.dp, bottom = 16.dp))
                            p.member && p.canWear == false -> Txt(t("serverTag.keptToRoles"), style = note, color = c.textMuted, modifier = Modifier.padding(top = 12.dp, bottom = 16.dp))
                            else -> Box(Modifier.height(16.dp))
                        }
                    },
                )
            }
        }
    }
}
