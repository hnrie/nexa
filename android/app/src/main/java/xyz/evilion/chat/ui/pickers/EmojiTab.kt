package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.common.ServerIcon
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.ui.theme.chatColors

/**
 * Emoji: a category rail, a grid, a header pinned over it, and the tone menu.
 *
 * Nothing here is computed in the grid's content lambda. The old picker called
 * a 1 906-element filter nine times, and ran the search, on every recomposition
 * — on the thread drawing the frame. The whole layout is built once, off the
 * main thread, and the grid only draws it.
 */
@Composable
fun EmojiTab(
    state: ExpressionState,
    settings: JsonObject,
    serverId: String?,
    tone: Int,
    onPick: (Pick) -> Unit,
) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val emojis by AppState.emojis.collectAsState()
    val servers by AppState.servers.collectAsState()
    val packs by AppState.stickerPacks.collectAsState()
    var ready by remember { mutableStateOf(EmojiIndex.loaded) }

    LaunchedEffect(Unit) {
        EmojiIndex.load(context)
        ready = true
    }

    val query = state.emojiQuery
    val recents = remember(Expressions.recentKey(settings), tone, ready) { Expressions.recents(settings, tone) }

    val layout by produceState(
        EmojiLayout.Loading,
        query, tone, emojis, servers, packs, serverId, ready, recents,
    ) {
        if (!ready) {
            value = EmojiLayout.Loading
            return@produceState
        }
        // typing fast should not run the search once per keystroke
        if (query.isNotBlank()) delay(80)
        value = withContext(Dispatchers.Default) {
            buildEmojiLayout(query, tone, recents, emojis, servers, packs, serverId)
        }
    }

    // a new query starts at the top, as the web client does — but coming back
    // to this tab is not a new query, and must not throw the scroll away
    LaunchedEffect(state) {
        snapshotFlow { state.emojiQuery }.drop(1).collect { state.emojiGrid.scrollToItem(0) }
    }

    val active by remember(layout) {
        derivedStateOf { layout.sectionAt(state.emojiGrid.firstVisibleItemIndex) }
    }
    LaunchedEffect(active, layout) {
        state.activeSection = active
        state.footerCategory = layout.sections.getOrNull(active)?.takeIf { it.showHeader }?.title.orEmpty()
        // keep the rail's current chip in view, without fighting a rail scroll
        if (state.emojiRail.layoutInfo.visibleItemsInfo.none { it.index == active }) {
            state.emojiRail.animateScrollToItem(active)
        }
    }

    if (layout.loading) {
        Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = colors.brand)
            Spacer(Modifier.height(10.dp))
            Text(t("pickers.emojiPicker.loadingEmoji"), color = colors.textMuted, fontSize = 13.sp)
        }
        return
    }

    Row(Modifier.fillMaxSize()) {
        if (layout.sections.size > 1) {
            CategoryRail(layout, active) { index ->
                scope.launch { state.emojiGrid.animateScrollToItem(layout.headerIndices[index]) }
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(colors.borderSubtle))
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
            val columns = ((maxWidth - 16.dp) / 46.dp).toInt().coerceIn(6, 10)
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                state = state.emojiGrid,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(8.dp),
            ) {
                for (section in layout.sections) {
                    if (section.showHeader) {
                        item(key = "h:${section.key}", span = { GridItemSpan(maxLineSpan) }, contentType = "header") {
                            SectionHeader(section.title)
                        }
                    }
                    items(
                        section.cells,
                        key = { it.key },
                        contentType = { if (it.pick is Pick.Unicode) "unicode" else "custom" },
                    ) { cell ->
                        EmojiCellView(
                            cell = cell,
                            onPress = { state.pressed = it },
                            onClick = { onPick(cell.pick) },
                        )
                    }
                }
                if (layout.isEmpty && query.isNotBlank()) {
                    item(span = { GridItemSpan(maxLineSpan) }, contentType = "empty") {
                        EmptyLine(
                            t("pickers.emojiPicker.noEmojiMatch"),
                            if (query.contains(':')) null else t("pickers.emojiPicker.tipTypeNameInThe"),
                        )
                    }
                }
                if (layout.failed) {
                    item(span = { GridItemSpan(maxLineSpan) }, contentType = "failed") {
                        Text(
                            t("pickers.emojiPicker.emojiCouldNotBeLoaded"),
                            color = colors.textMuted,
                            fontSize = 12.sp,
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }

            // the pinned title, drawn over the grid rather than with it: a
            // full-span item cannot stick, and the rail and this must never
            // disagree about which section is showing
            val sticky by remember(layout) {
                derivedStateOf {
                    val index = layout.sectionAt(state.emojiGrid.firstVisibleItemIndex)
                    val section = layout.sections.getOrNull(index)
                    if (section != null && section.showHeader && state.emojiGrid.firstVisibleItemIndex > layout.headerIndices[index]) {
                        section.title
                    } else {
                        null
                    }
                }
            }
            sticky?.let {
                Box(Modifier.align(Alignment.TopStart).fillMaxWidth().background(colors.bgFloating)) {
                    SectionHeader(it)
                }
            }
        }
    }
}

/** Recents, then each server, then each pack, then the nine categories. */
@Composable
private fun CategoryRail(layout: EmojiLayout, active: Int, onJump: (Int) -> Unit) {
    LazyColumn(Modifier.width(44.dp).fillMaxHeight()) {
        items(layout.sections.size, key = { layout.sections[it].key }) { index ->
            val section = layout.sections[index]
            RailButton(selected = index == active, label = section.title, onClick = { onJump(index) }) {
                when (section.rail.kind) {
                    RailKind.SERVER -> ServerIcon(
                        section.rail.serverId.orEmpty(),
                        section.rail.name.ifEmpty { section.title },
                        section.rail.iconId,
                        26.dp,
                    )
                    RailKind.PACK -> PackCover(section.rail.name.ifEmpty { section.title }, section.rail.blobId, 24.dp, emojiPack = true)
                    else -> TwemojiImage(section.rail.emoji.orEmpty(), 22.dp, fallbackSize = 20.sp)
                }
            }
        }
    }
}

@Composable
fun SectionHeader(title: String) {
    Text(
        title.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = chatColors.textMuted,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, end = 4.dp, top = 10.dp, bottom = 4.dp)
            .semantics { heading() },
    )
}

@Composable
fun EmptyLine(title: String, detail: String? = null) {
    val colors = chatColors
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, color = colors.textSubtle, fontSize = 14.sp, textAlign = TextAlign.Center)
        if (detail != null) {
            Spacer(Modifier.height(6.dp))
            Text(detail, color = colors.textMuted, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
    }
}
