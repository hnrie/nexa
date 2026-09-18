package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.net.ExpressionsApi
import xyz.evilion.chat.net.Sticker
import xyz.evilion.chat.net.StickerPack
import xyz.evilion.chat.ui.detached
import xyz.evilion.chat.ui.theme.chatColors

/** A pack in the rail, and where its header sits in the grid's items. */
private data class RailPack(val pack: StickerPack, val itemIndex: Int)

/**
 * Stickers: a pack rail and a grid grouped the way the web groups it —
 * this server's packs, then mine, then ones I installed, then other servers'.
 *
 * The old sheet listed packs in whatever order the map came back in, and was
 * only reachable by tapping the word "Stickers" inside the GIF sheet.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun StickerTab(
    state: ExpressionState,
    packs: List<StickerPack>,
    serverId: String?,
    onPick: (Sticker) -> Unit,
) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val me by AppState.me.collectAsState()
    val query = state.stickerQuery

    val groups = remember(packs, serverId, me?.id) { Expressions.groupPacks(packs, serverId, me?.id) }
    val rail = remember(groups) {
        var index = 0
        buildList {
            for (group in groups) {
                index += 1
                for (pack in group.packs) {
                    add(RailPack(pack, index))
                    index += 1 + if (pack.stickers.isEmpty()) 1 else pack.stickers.size
                }
            }
        }
    }
    val results = remember(packs, query) {
        if (query.isBlank()) emptyList() else searchStickers(packs.filter { it.kind != "emoji" }, query)
    }

    if (groups.isEmpty()) {
        EmptyLine(t("pickers.pickers.noStickerPacksYet"), t("pickers.stickerPicker.packsYouInstallOrThat"))
        return
    }

    val active by remember(rail) {
        derivedStateOf {
            val first = state.stickerGrid.firstVisibleItemIndex
            rail.indexOfLast { it.itemIndex <= first }.coerceAtLeast(0)
        }
    }

    Row(Modifier.fillMaxSize()) {
        if (query.isBlank() && rail.size > 1) {
            PackRail(rail, active) { index ->
                scope.launch { state.stickerGrid.animateScrollToItem(rail[index].itemIndex) }
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(colors.borderSubtle))
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
            val columns = (maxWidth / 96.dp).toInt().coerceIn(3, 5)
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                state = state.stickerGrid,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(8.dp),
            ) {
                if (query.isNotBlank()) {
                    if (results.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            EmptyLine(t("pickers.stickerPicker.noStickersMatch"))
                        }
                    }
                    items(results, key = { "${it.second.id}:${it.first.id}" }, contentType = { "sticker" }) { (sticker, _) ->
                        StickerCell(sticker) { onPick(sticker) }
                    }
                    return@LazyVerticalGrid
                }
                for (group in groups) {
                    item(key = "g:${group.label}", span = { GridItemSpan(maxLineSpan) }, contentType = "group") {
                        SectionHeader(group.label)
                    }
                    for (pack in group.packs) {
                        item(key = "p:${pack.id}", span = { GridItemSpan(maxLineSpan) }, contentType = "pack") {
                            Text(
                                pack.name,
                                color = colors.text,
                                fontSize = 13.sp,
                                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 4.dp),
                            )
                        }
                        if (pack.stickers.isEmpty()) {
                            item(key = "e:${pack.id}", span = { GridItemSpan(maxLineSpan) }, contentType = "empty") {
                                Text(
                                    t("pickers.stickerPicker.thisPackIsEmpty"),
                                    color = colors.textMuted,
                                    fontSize = 12.sp,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
                                )
                            }
                        }
                        items(pack.stickers, key = { "${pack.id}:${it.id}" }, contentType = { "sticker" }) { sticker ->
                            StickerCell(sticker) { onPick(sticker) }
                        }
                    }
                }
            }
        }
    }

}

/** Each pack's cover, down the inline-start edge. */
@Composable
private fun PackRail(rail: List<RailPack>, active: Int, onJump: (Int) -> Unit) {
    LazyColumn(Modifier.width(44.dp).fillMaxHeight()) {
        items(rail.size, key = { rail[it].pack.id }) { index ->
            PackRailButton(rail[index].pack, index == active) { onJump(index) }
        }
    }
}

/**
 * One pack in the rail.
 *
 * A long press offers the only pack management the phone can honestly give:
 * removing one you installed. There is no sticker settings page on Android, so
 * the web's Edit and "create or install a pack" would be dead links and are not
 * drawn.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PackRailButton(pack: StickerPack, selected: Boolean, onJump: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    val cover = pack.stickers.firstOrNull { it.id == pack.coverStickerId } ?: pack.stickers.firstOrNull()

    Box {
        Box(
            Modifier
                .size(44.dp, 48.dp)
                .padding(4.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) colors.bgSelected else Color.Transparent)
                .combinedClickable(
                    onClickLabel = pack.name,
                    role = Role.Tab,
                    onLongClick = if (pack.installed) ({ menu = true }) else null,
                    onClick = onJump,
                ),
            Alignment.Center,
        ) {
            PackCover(pack.name, cover?.blobId, 28.dp, emojiPack = false)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = colors.bgFloating) {
            DropdownMenuItem(
                text = { Text(t("pickers.stickerPicker.removeFromYourPacks"), color = colors.danger, fontSize = 14.sp) },
                onClick = {
                    menu = false
                    detached {
                        runCatching { ExpressionsApi.install(pack.id, false) }
                            .onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                    }
                },
            )
        }
    }
}

@Composable
private fun StickerCell(sticker: Sticker, onClick: () -> Unit) {
    Box(
        Modifier.size(96.dp).clickable(onClickLabel = sticker.name, role = Role.Button, onClick = onClick),
        Alignment.Center,
    ) {
        AsyncImage(
            model = Media.sticker(sticker.blobId, 160),
            contentDescription = sticker.name,
            modifier = Modifier.size(84.dp),
        )
    }
}
