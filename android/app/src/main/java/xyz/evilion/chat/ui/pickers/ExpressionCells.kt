package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.decode.BitmapFactoryDecoder
import coil3.request.ImageRequest
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.ui.theme.chatColors

/**
 * An emoji's picture, asked for as a **still** frame.
 *
 * The server hands back an animated blob under 512 px untouched, so a grid of
 * animated custom emoji would hold one running drawable per visible cell. The
 * message list wants the moving copy, so this one carries its own memory cache
 * key and cannot evict it.
 */
@Composable
fun stillEmoji(blobId: String, size: Int): ImageRequest {
    val context = LocalPlatformContext.current
    return remember(blobId, size) {
        val url = Media.emoji(blobId, size)
        ImageRequest.Builder(context)
            .data(url)
            .decoderFactory(BitmapFactoryDecoder.Factory())
            .memoryCacheKey("$url@still")
            .build()
    }
}

/**
 * One emoji in the grid.
 *
 * 46 dp is under Material's 48 dp target, which every emoji grid does; the
 * grid's 8 dp content padding gives the edge rows a little slop. Holding a cell
 * names it in the footer — a phone has no hover, and the web's inspector is
 * hover-driven — and releasing without dragging picks it.
 */
@Composable
fun EmojiCellView(
    cell: EmojiCell,
    size: Dp = 46.dp,
    picture: Dp = 30.dp,
    onPress: (EmojiCell?) -> Unit,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    LaunchedEffect(pressed) { onPress(if (pressed) cell else null) }

    Box(
        Modifier
            .size(size)
            .clickable(
                interactionSource = interaction,
                indication = ripple(bounded = false, radius = size / 2),
                onClickLabel = cell.label,
                role = Role.Button,
                onClick = onClick,
            ),
        Alignment.Center,
    ) {
        PickImage(
            cell.pick, picture, cell.label,
            // a remembered custom emoji whose blob has since been deleted is
            // dropped from the list rather than left as a grey box for ever
            onMissing = if (cell.key.startsWith("r:")) ({ Expressions.forgetCustom(Expressions.token(cell.pick)) }) else null,
        )
        if (cell.animated) AnimatedDot(Modifier.align(Alignment.TopEnd))
    }
}

/** A pick's picture, wherever it is drawn: a grid cell, the footer, the quick row. */
@Composable
fun PickImage(
    pick: Pick,
    size: Dp,
    label: String,
    modifier: Modifier = Modifier,
    animate: Boolean = false,
    onMissing: (() -> Unit)? = null,
) {
    when (pick) {
        is Pick.Unicode -> TwemojiImage(pick.text, size, modifier, fallbackSize = (size.value * 0.86f).sp)
        is Pick.Custom -> AsyncImage(
            model = if (animate) Media.emoji(pick.blobId, 128) else stillEmoji(pick.blobId, 64),
            contentDescription = label,
            onError = onMissing?.let { missing -> { missing() } },
            modifier = modifier.size(size),
        )
    }
}

/** The mark Discord puts on an animated emoji, so it is clear it moves when sent. */
@Composable
private fun AnimatedDot(modifier: Modifier = Modifier) {
    Box(modifier.padding(4.dp).size(6.dp).clip(CircleShape).background(chatColors.brand))
}

/** A category, server, pack or recents button down the inline-start edge. */
@Composable
fun RailButton(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = chatColors
    Box(
        Modifier
            .size(44.dp, 48.dp)
            .padding(4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) colors.bgSelected else Color.Transparent)
            .clickable(onClickLabel = label, role = Role.Tab, onClick = onClick),
        Alignment.Center,
    ) {
        content()
    }
}

/** A pack's cover, or its first letters when it has no stickers to show one. */
@Composable
fun PackCover(name: String, blobId: String?, size: Dp, emojiPack: Boolean) {
    val colors = chatColors
    if (blobId != null) {
        AsyncImage(
            model = if (emojiPack) stillEmoji(blobId, 64) else Media.sticker(blobId, 96),
            contentDescription = name,
            modifier = Modifier.size(size),
        )
    } else {
        Box(Modifier.size(size).clip(RoundedCornerShape(6.dp)).background(colors.bgSurface), Alignment.Center) {
            Text(
                name.take(2).uppercase().ifEmpty { "?" },
                color = colors.text,
                fontSize = (size.value * 0.4f).sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
