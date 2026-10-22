package fish.nexa.ui.chat

import androidx.compose.animation.core.FastOutSlowInEasing
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
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import fish.nexa.data.NameStyle
import kotlinx.serialization.json.JsonElement
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
    /** The person's own name style (data/NameStyle): its font always shows, its colours only without a role colour. */
    val own: NameStyle? = null,
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

    /** A look with the person's own name style added, from the name_style the server sent. */
    fun withOwn(look: RoleLook?, nameStyle: JsonElement?): RoleLook? {
        val own = NameStyle.read(nameStyle) ?: return look
        return (look ?: RoleLook(color = null)).copy(own = own)
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
 * still with Reduce Motion on. The person's own name style sets its font, and
 * draws its effect where no role colours the name (styles/nameStyle.css).
 */
@Composable
fun RoleName(text: String, look: RoleLook?, style: TextStyle, fallback: Color, modifier: Modifier = Modifier, maxLines: Int = 1) {
    val own = look?.own
    val family = own?.font?.takeIf { it.isNotEmpty() }?.let { NameFonts.family(it) }
    val scale = own?.font?.let { f -> NameStyle.FONTS.firstOrNull { it.id == f }?.scale } ?: 1f
    val styled = if (family != null) style.copy(fontFamily = family, fontSize = style.fontSize * scale, letterSpacing = 0.sp) else style
    if (look?.color == null && own != null && own.colors.isNotEmpty()) {
        OwnName(text, own, styled, modifier, maxLines)
        return
    }
    val colors = look?.colors
    if (colors == null) {
        Txt(text, style = styled, color = look?.color ?: fallback, maxLines = maxLines, modifier = modifier)
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
    PlainName(text, styled.copy(brush = brush), modifier, maxLines)
}

/** Drawn here rather than with Txt, whose colour would take a brush's place. */
@Composable
private fun PlainName(text: String, style: TextStyle, modifier: Modifier, maxLines: Int) {
    androidx.compose.foundation.text.BasicText(
        text = text,
        modifier = modifier,
        style = style,
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
    )
}

/** A name in its own effect and colours (lib/nameStyle.ts, styles/nameStyle.css). */
@Composable
private fun OwnName(text: String, own: NameStyle, style: TextStyle, modifier: Modifier, maxLines: Int) {
    val light = Nx.colors.isLight
    val cs = own.colors.map { rgbColor(it) }
    val c1 = cs.first()
    val c2 = cs.getOrElse(1) { c1 }
    val em = with(LocalDensity.current) { style.fontSize.toPx() }
    when (own.effect) {
        "gradient" -> PlainName(text, style.copy(brush = Brush.horizontalGradient(listOf(c1, c2))), modifier, maxLines)
        "glow" -> PlainName(
            text,
            style.copy(
                color = if (light) lerp(Color.Black, c1, 0.75f) else lerp(Color.White, c1, 0.35f),
                shadow = Shadow(if (light) c1.copy(alpha = 0.7f) else c1, Offset.Zero, em * if (light) 0.35f else 0.4f),
            ),
            modifier, maxLines,
        )
        "ink" -> {
            // the colour, a dark line round it and a shadow under it
            val line = lerp(Color(0xFF12060C), c1, 0.35f)
            Box(modifier) {
                PlainName(text, style.copy(color = line, drawStyle = Stroke(width = em * 0.16f, join = StrokeJoin.Round), shadow = Shadow(line, Offset(em * 0.03f, em * 0.1f), 0f)), Modifier, maxLines)
                PlainName(text, style.copy(color = c1), Modifier, maxLines)
            }
        }
        "pop" -> PlainName(
            text,
            style.copy(color = if (light) Color.White else lerp(Color.White, c1, 0.1f), shadow = Shadow(c1, Offset(em * 0.05f, em * 0.09f), 0f)),
            modifier, maxLines,
        )
        "candy" -> {
            // hard stripes, leaning, like boiled sweets
            val band = em * 0.42f
            val brush = remember(cs, band) {
                object : ShaderBrush() {
                    override fun createShader(size: Size): Shader {
                        val run = band * cs.size
                        val colors = cs.flatMap { listOf(it, it) }
                        val stops = cs.indices.flatMap { i -> listOf(i.toFloat() / cs.size, (i + 1f) / cs.size) }
                        return LinearGradientShader(Offset.Zero, Offset(run * 0.985f, run * 0.174f), colors, stops, TileMode.Repeated)
                    }
                }
            }
            PlainName(text, style.copy(brush = brush), modifier, maxLines)
        }
        "aurora" -> {
            // every colour flowing through the name and round again
            val phase = if (!Nx.motion.reduced) {
                val t = rememberInfiniteTransition(label = "aurora")
                val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(6000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "aurora")
                p
            } else 0f
            val stops = cs + cs.first()
            val brush = remember(stops, phase) {
                object : ShaderBrush() {
                    override fun createShader(size: Size): Shader {
                        val w = size.width * 3f
                        val x0 = -phase * (w - size.width)
                        return LinearGradientShader(Offset(x0, 0f), Offset(x0 + w, 0f), stops, tileMode = TileMode.Clamp)
                    }
                }
            }
            PlainName(text, style.copy(brush = brush), modifier, maxLines)
        }
        "chrome" -> {
            // polished metal tinted by the colour: a bright sky, a hard horizon, a dark ground
            val brush = Brush.verticalGradient(
                0f to lerp(Color.White, c1, 0.2f),
                0.46f to lerp(Color.White, c1, 0.55f),
                0.52f to lerp(Color(0xFF10131A), c1, 0.6f),
                0.78f to c1,
                1f to lerp(Color.White, c1, 0.35f),
            )
            PlainName(text, style.copy(brush = brush), modifier, maxLines)
        }
        else -> PlainName(text, style.copy(color = c1), modifier, maxLines)
    }
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
