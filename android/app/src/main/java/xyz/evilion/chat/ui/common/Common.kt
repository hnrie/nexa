package xyz.evilion.chat.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.net.PublicUser
import xyz.evilion.chat.ui.theme.chatColors

private val PALETTE = listOf(
    Color(0xFF5865F2), Color(0xFF3D9E60), Color(0xFFFDB833),
    Color(0xFFDA3E44), Color(0xFFEB459F), Color(0xFF82838B),
)

/** The same colour the web client picks for someone with no avatar. */
fun avatarColor(id: String): Color {
    var h = 0
    for (c in id) h = (h * 31 + c.code)
    return PALETTE[((h % PALETTE.size) + PALETTE.size) % PALETTE.size]
}

fun initial(name: String): String = name.trim().firstOrNull()?.uppercase() ?: "?"

@Composable
fun Avatar(
    userId: String,
    name: String,
    avatarId: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    status: String? = null,
    ringColor: Color? = null,
) {
    val colors = chatColors
    Box(modifier.size(size)) {
        val url = Media.avatar(avatarId, (size.value * 2).toInt())
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape)
                    .then(if (ringColor != null) Modifier.border(2.dp, ringColor, CircleShape) else Modifier),
            )
        } else {
            Box(
                Modifier.size(size).clip(CircleShape).background(avatarColor(userId))
                    .then(if (ringColor != null) Modifier.border(2.dp, ringColor, CircleShape) else Modifier),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initial(name),
                    color = Color.White,
                    fontSize = (size.value * 0.42f).sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        if (status != null) {
            val dot = (size.value * 0.34f).coerceAtLeast(10f).dp
            Box(
                Modifier.align(Alignment.BottomEnd).size(dot + 4.dp).clip(CircleShape).background(colors.bgBase),
                contentAlignment = Alignment.Center,
            ) {
                StatusDot(status, dot)
            }
        }
    }
}

@Composable
fun Avatar(user: PublicUser?, size: Dp, modifier: Modifier = Modifier, status: String? = null) {
    Avatar(user?.id ?: "0", user?.name ?: "?", user?.avatarId, size, modifier, status)
}

@Composable
fun StatusDot(status: String, size: Dp = 10.dp) {
    val colors = chatColors
    val color = when (status) {
        "online" -> colors.statusOnline
        "idle" -> colors.statusIdle
        "dnd" -> colors.statusDnd
        else -> colors.statusOffline
    }
    Box(Modifier.size(size).clip(CircleShape).background(color))
}

/** A server's icon: its picture, or its initials on a rounded square. */
@Composable
fun ServerIcon(
    id: String,
    name: String,
    iconId: String?,
    size: Dp,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val colors = chatColors
    val shape = RoundedCornerShape(if (selected) (size.value * 0.3f).dp else (size.value * 0.5f).dp)
    val url = Media.icon(iconId, (size.value * 2).toInt())
    Box(modifier.size(size).clip(shape).background(if (url == null) colors.bgSurface else Color.Transparent), Alignment.Center) {
        if (url != null) {
            AsyncImage(model = url, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Text(
                name.split(" ").take(2).mapNotNull { it.firstOrNull() }.joinToString("").uppercase().ifEmpty { "?" },
                color = colors.text,
                fontSize = (size.value * 0.34f).sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), Alignment.Center) {
        CircularProgressIndicator(color = chatColors.brand)
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, message: String? = null, modifier: Modifier = Modifier) {
    val colors = chatColors
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = colors.textPlaceholder, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, color = colors.textSubtle, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (message != null) {
            Spacer(Modifier.height(6.dp))
            Text(message, color = colors.textMuted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }
    }
}

/** A thin divider in the palette's border colour. */
@Composable
fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(chatColors.borderSubtle))
}

/** The unread pill the sidebar and the server rail use. */
@Composable
fun Badge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    val colors = chatColors
    Box(
        modifier.clip(CircleShape).background(colors.danger).padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** How a presence reads in a list: the status, or what they are playing. */
@Composable
fun presenceOf(userId: String): String {
    val presences = AppState.presences
    return presences.value[userId]?.status ?: "offline"
}
