package fish.nexa.ui.chat

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.ServerState
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.net.Role
import fish.nexa.ui.components.Txt
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.rgbColor
import java.util.WeakHashMap

/** A role's picture beside names: one of its own, an emoji, or one of the server's emoji (lib/roleLook.ts). */
sealed interface RoleIconInfo {
    val name: String
    data class Image(val id: String, override val name: String) : RoleIconInfo
    data class Emoji(val text: String, override val name: String) : RoleIconInfo
    data class Custom(val id: String, override val name: String) : RoleIconInfo
}

/** How a member's name is drawn in a server: their highest coloured role's colours, and their highest role's icon. */
data class RoleLook(
    val color: Color?,
    /** Two or three colours: the name is drawn in a gradient of them. */
    val colors: List<Color>? = null,
    /** Three colours shimmer across the name. */
    val shimmer: Boolean = false,
    val icon: RoleIconInfo? = null,
)

object RoleLooks {
    /** A role's own icon, if it has one. */
    fun iconOf(r: Role): RoleIconInfo? = when {
        r.iconId != null -> RoleIconInfo.Image(r.iconId, r.name)
        r.iconEmoji.startsWith("custom:") -> RoleIconInfo.Custom(r.iconEmoji.removePrefix("custom:"), r.name)
        r.iconEmoji.isNotEmpty() -> RoleIconInfo.Emoji(r.iconEmoji, r.name)
        else -> null
    }

    /** The colours a role draws names in: one, or a gradient of two or three. */
    fun colorsOf(r: Role): List<Color> {
        if (r.color == 0L) return emptyList()
        val out = arrayListOf(rgbColor(r.color))
        val c2 = r.color2
        val c3 = r.color3
        if (c2 != null) out += rgbColor(c2)
        if (c2 != null && c3 != null) out += rgbColor(c3)
        return out
    }

    private val looks = WeakHashMap<ServerState, HashMap<String, RoleLook?>>()

    /** How a member's name looks in a server, worked out once per state of it. */
    @Synchronized
    fun of(st: ServerState?, userId: String): RoleLook? {
        if (st == null) return null
        val byUser = looks.getOrPut(st) { HashMap() }
        if (byUser.containsKey(userId)) return byUser[userId]
        val m = st.members[userId]
        var colored: Role? = null
        var iconed: Role? = null
        for (id in m?.roleIds ?: emptyList()) {
            val r = st.roles[id] ?: continue
            if (r.color != 0L && (colored == null || r.position > colored.position)) colored = r
            if ((r.iconId != null || r.iconEmoji.isNotEmpty()) && (iconed == null || r.position > iconed.position)) iconed = r
        }
        val look = if (colored == null && iconed == null) null else {
            val colors = colored?.let { colorsOf(it) } ?: emptyList()
            RoleLook(
                color = colors.firstOrNull(),
                colors = colors.takeIf { it.size > 1 },
                shimmer = colors.size > 2,
                icon = iconed?.let { iconOf(it) },
            )
        }
        byUser[userId] = look
        return look
    }
}

/**
 * A name in its roles' colours (`.role-gradient`, `.role-shimmer`): one
 * colour, a gradient across the name, or three colours drifting along it,
 * still with Reduce Motion on.
 */
@Composable
fun RoleName(text: String, look: RoleLook?, style: TextStyle, fallback: Color, modifier: Modifier = Modifier, maxLines: Int = 1) {
    val colors = look?.colors
    if (colors == null) {
        Txt(text, style = style, color = look?.color ?: fallback, maxLines = maxLines, modifier = modifier)
        return
    }
    val phase = if (look.shimmer && !Nx.motion.reduced) {
        val t = rememberInfiniteTransition(label = "shimmer")
        val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(4000, easing = LinearEasing), RepeatMode.Restart), label = "shimmer")
        p
    } else 0f
    // a shimmer's colours run out and back to the first, so the loop has no seam
    val stops = if (look.shimmer) colors + colors.first() else colors
    val brush = remember(stops, look.shimmer, phase) {
        object : ShaderBrush() {
            override fun createShader(size: Size): Shader {
                val w = if (look.shimmer) size.width * 2f else size.width
                val x0 = -phase * w
                return LinearGradientShader(Offset(x0, 0f), Offset(x0 + w, 0f), stops, tileMode = if (look.shimmer) TileMode.Repeated else TileMode.Clamp)
            }
        }
    }
    // drawn here rather than with Txt, whose colour would take the brush's place
    androidx.compose.foundation.text.BasicText(
        text = text,
        modifier = modifier,
        style = style.copy(brush = brush),
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) androidx.compose.ui.text.style.TextOverflow.Clip else androidx.compose.ui.text.style.TextOverflow.Ellipsis,
    )
}

/** A role's picture beside a name, named for the role it stands for. */
@Composable
fun RoleIcon(icon: RoleIconInfo, size: Dp) {
    val density = LocalDensity.current.density
    Box(Modifier.size(size).semantics { contentDescription = icon.name }, contentAlignment = Alignment.Center) {
        when (icon) {
            is RoleIconInfo.Image -> AsyncImage(Media.iconUrl(icon.id, size.value.toInt(), density), null, Media.loader, modifier = Modifier.size(size))
            is RoleIconInfo.Custom -> Nexa.expressions.emoji(icon.id)?.let { e ->
                AsyncImage(Media.emojiUrl(e.blobId, size.value.toInt(), density), null, Media.loader, modifier = Modifier.size(size))
            }
            is RoleIconInfo.Emoji -> TwemojiImage(icon.text, size * 0.9f)
        }
    }
}

/** The brush a gradient name is painted with, for places that draw names themselves. */
fun RoleLook.staticBrush(): Brush? = colors?.let { Brush.horizontalGradient(it) }
