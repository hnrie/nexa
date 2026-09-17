package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.decode.BitmapFactoryDecoder
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.ExpressionsApi
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors

/**
 * Whether this instance has a GIF provider.
 *
 * The instance payload already says so, so unlike the browser the phone draws
 * the tab without waiting for a round trip; `/gif/status` is asked once per
 * session in the background and wins if the two disagree.
 */
object GifStatus {
    val enabled = MutableStateFlow<Boolean?>(null)

    @Volatile
    private var asked = false

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun confirm() {
        if (asked) return
        asked = true
        scope.launch {
            runCatching { ExpressionsApi.gifStatus() }
                .onSuccess { enabled.value = (it["enabled"] as? JsonPrimitive)?.booleanOrNull ?: false }
                .onFailure { asked = false }
        }
    }
}

/** How close to the end of the grid a scroll gets before the next page is asked for. */
private const val PAGE_AHEAD = 8

/**
 * GIFs: favourites, trending, and search.
 *
 * Favourites are new on Android and are the same `favoriteGifs` array the web
 * and the desktop app write, so one starred on a laptop is here. The old sheet
 * had no favourites, no paging, no debounce, and told an offline phone that the
 * server had no GIF provider.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GifTab(state: ExpressionState, settings: JsonObject, enabled: Boolean, onPick: (GifPick) -> Unit) {
    val colors = chatColors
    val favorites = remember(Expressions.favoritesKey(settings)) { Expressions.favorites(settings) }
    // one set, not a fresh parse of the whole array per tile per frame
    val favoriteUrls = remember(favorites) { favorites.mapTo(mutableSetOf()) { it.url } }

    // with no provider there is nothing to search; otherwise open where the web
    // opens — on favourites when there are any, on search when there are none —
    // and afterwards on whatever chip was last tapped, which survives a swipe
    val mode = when {
        !enabled -> GifMode.FAVORITES
        state.gifMode != null -> state.gifMode!!
        favorites.isNotEmpty() -> GifMode.FAVORITES
        else -> GifMode.SEARCH
    }
    LaunchedEffect(mode) { state.gifMode = mode }

    // the query the results belong to is carried with them, so a page that
    // arrives after the query changed cannot be appended to the new one
    LaunchedEffect(state, enabled) {
        if (!enabled) return@LaunchedEffect
        snapshotFlow { state.gifQuery.trim() }
            .distinctUntilChanged()
            .collectLatest { query ->
                // coming back to this tab is not a new search
                if (state.gifShownFor == query && !state.gifFailed) return@collectLatest
                if (query.isNotEmpty()) delay(300)
                state.gifLoading = true
                state.gifFailed = false
                state.gifPageFailed = false
                runCatching {
                    if (query.isEmpty()) ExpressionsApi.gifTrending() else ExpressionsApi.gifSearch(query)
                }.onSuccess { page ->
                    state.gifResults = page.results.map {
                        GifTile(it.id, GifPick(it.url, it.w, it.h), it.title, it.preview.ifEmpty { it.url })
                    }
                    state.gifCursor = page.next
                    state.gifShownFor = query
                }.onFailure {
                    state.gifResults = emptyList()
                    state.gifCursor = ""
                    state.gifShownFor = query
                    state.gifFailed = true
                }
                state.gifLoading = false
            }
    }

    // one more page when the bottom comes into view
    LaunchedEffect(state, enabled) {
        if (!enabled) return@LaunchedEffect
        snapshotFlow { state.gifGrid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { last ->
                if (state.gifMode != GifMode.SEARCH) return@collect
                if (state.gifPaging || state.gifLoading || state.gifPageFailed) return@collect
                val cursor = state.gifCursor
                val shownFor = state.gifShownFor ?: return@collect
                if (cursor.isEmpty() || last < state.gifResults.size - PAGE_AHEAD) return@collect
                state.gifPaging = true
                runCatching {
                    if (shownFor.isEmpty()) ExpressionsApi.gifTrending(cursor) else ExpressionsApi.gifSearch(shownFor, cursor)
                }.onSuccess { page ->
                    // the query may have moved on while this was in flight
                    if (state.gifShownFor == shownFor) {
                        val seen = state.gifResults.mapTo(mutableSetOf()) { it.key }
                        val fresh = page.results.filterNot { it.id in seen }.map {
                            GifTile(it.id, GifPick(it.url, it.w, it.h), it.title, it.preview.ifEmpty { it.url })
                        }
                        state.gifResults = state.gifResults + fresh
                        // an empty page is the end, whatever cursor came back with it
                        state.gifCursor = if (page.results.isEmpty()) "" else page.next
                    }
                }.onFailure {
                    if (state.gifShownFor == shownFor) state.gifPageFailed = true
                }
                state.gifPaging = false
            }
    }

    val tiles = if (mode == GifMode.FAVORITES) {
        remember(favorites) { favorites.map { GifTile(it.url, it, t("pickers.gifPicker.favoriteGif"), it.url) } }
    } else {
        state.gifResults
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chip(t("pickers.gifPicker.favorites"), mode == GifMode.FAVORITES) {
                state.gifMode = GifMode.FAVORITES
            }
            if (enabled) {
                Chip(
                    if (state.gifQuery.isBlank()) t("pickers.gifPicker.trending") else t("pickers.gifPicker.results"),
                    mode == GifMode.SEARCH,
                ) { state.gifMode = GifMode.SEARCH }
            }
        }

        when {
            !enabled && favorites.isEmpty() -> EmptyLine(
                t("pickers.pickers.gifSearchIsNotSetUp"),
                t("pickers.gifPicker.starInChat"),
            )
            mode == GifMode.FAVORITES && favorites.isEmpty() -> EmptyLine(
                t("pickers.gifPicker.noFavoritesYet"),
                if (enabled) t("pickers.gifPicker.starInSearch") else t("pickers.gifPicker.starInChat"),
            )
            mode == GifMode.SEARCH && state.gifLoading && tiles.isEmpty() ->
                Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.brand) }
            mode == GifMode.SEARCH && state.gifFailed -> EmptyLine(
                t("pickers.gifPicker.couldNotReachTheServer"),
                t("chat.messageList.tryAgain"),
            )
            mode == GifMode.SEARCH && tiles.isEmpty() && state.gifShownFor != null -> EmptyLine(
                if (state.gifShownFor.orEmpty().isBlank()) t("pickers.gifPicker.nothingTrendingRightNow")
                else t("pickers.gifPicker.noGifsMatch"),
            )
            else -> LazyVerticalStaggeredGrid(
                columns = StaggeredGridCells.Fixed(2),
                state = state.gifGrid,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(8.dp),
                verticalItemSpacing = 6.dp,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(tiles, key = { it.key }, contentType = { "gif" }) { tile ->
                    GifTileView(
                        tile = tile,
                        favorite = mode == GifMode.FAVORITES || tile.gif.url in favoriteUrls,
                        dead = tile.gif.url in state.deadGifs,
                        // only a favourite goes "gone": a search result that
                        // failed once is a network hiccup, not a dead provider
                        onDead = { if (mode == GifMode.FAVORITES) state.deadGifs = state.deadGifs + tile.gif.url },
                        onPick = { onPick(tile.gif) },
                    )
                }
                if (state.gifPaging) {
                    item(span = StaggeredGridItemSpan.FullLine) {
                        Box(Modifier.fillMaxWidth().padding(12.dp), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(20.dp), color = colors.brand, strokeWidth = 2.dp)
                        }
                    }
                }
            }
        }
    }
}

/** One GIF. Long press offers sending it and starring it; a tap sends it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GifTileView(
    tile: GifTile,
    favorite: Boolean,
    dead: Boolean,
    onDead: () -> Unit,
    onPick: () -> Unit,
) {
    val colors = chatColors
    val context = LocalPlatformContext.current
    var menu by remember { mutableStateOf(false) }
    val ratio = if (tile.gif.h > 0 && tile.gif.w > 0) {
        (tile.gif.w.toFloat() / tile.gif.h).coerceIn(0.5f, 2f)
    } else {
        1.3f
    }

    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(6.dp))
            .background(colors.bgSurface)
            .combinedClickable(
                onClickLabel = tile.title.ifEmpty { t("pickers.expressionPicker.gifs") },
                role = Role.Button,
                onLongClick = { menu = true },
                onClick = { if (!dead) onPick() },
            ),
    ) {
        if (dead) {
            Text(
                t("pickers.gifGrid.thisOneIsGone"),
                color = colors.textMuted,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.Center).padding(8.dp),
            )
        } else {
            val model = remember(tile.preview) {
                val builder = ImageRequest.Builder(context).data(tile.preview)
                // the setting exists and nothing honoured it here before
                if (SettingsStore.reducedMotion) builder.decoderFactory(BitmapFactoryDecoder.Factory())
                builder.build()
            }
            AsyncImage(
                model = model,
                contentDescription = tile.title.ifEmpty { t("pickers.expressionPicker.gifs") },
                contentScale = ContentScale.Crop,
                onError = { onDead() },
                modifier = Modifier.fillMaxSize(),
            )
        }
        // an invisible corner button steals taps on a touch screen, so the star
        // is only drawn when it is already one — the web's `@media (hover: none)`
        if (favorite) {
            Box(
                Modifier.align(Alignment.TopEnd).padding(4.dp).size(20.dp)
                    .clip(CircleShape).background(colors.bgOverlay),
                Alignment.Center,
            ) {
                Icon(Lucide.Star, t("pickers.gifPicker.favoriteGif"), tint = colors.brand, modifier = Modifier.size(12.dp))
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = colors.bgFloating) {
            if (!dead) {
                DropdownMenuItem(
                    text = { Text(t("pickers.gifPicker.sendGif"), color = colors.text, fontSize = 14.sp) },
                    onClick = {
                        menu = false
                        onPick()
                    },
                )
            }
            DropdownMenuItem(
                text = {
                    Text(
                        if (favorite) t("pickers.gifPicker.removeFromFavorites") else t("pickers.gifPicker.addToFavorites"),
                        color = if (favorite) colors.danger else colors.text,
                        fontSize = 14.sp,
                    )
                },
                onClick = {
                    menu = false
                    Expressions.toggleFavorite(tile.gif)
                },
            )
        }
    }
}

/** The provider's line, the paging error that keeps what is shown, and dead favourites. */
@Composable
fun RowScope.GifFooter(state: ExpressionState) {
    val colors = chatColors
    val dead = state.deadGifs
    when {
        state.gifPageFailed -> {
            Text(
                t("pickers.gifPicker.moreGifsCouldNotBeLoaded"),
                color = colors.textMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                t("chat.messageList.tryAgain"),
                color = colors.textBrand,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { state.gifPageFailed = false },
            )
        }
        state.gifMode == GifMode.FAVORITES && dead.isNotEmpty() -> {
            Text(
                t("pickers.gifPicker.someFavoritesNoLongerLoad"),
                color = colors.textMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                t("pickers.gifPicker.removeThem"),
                color = colors.textBrand,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable {
                    Expressions.removeFavorites(dead)
                    state.deadGifs = emptySet()
                },
            )
        }
        state.gifMode == GifMode.SEARCH && state.gifResults.isNotEmpty() -> Text(
            t("pickers.gifPicker.searchPoweredByKlipyThisServer"),
            color = colors.textMuted,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A pill that chooses between favourites and search. */
@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = chatColors
    Text(
        label,
        color = if (selected) colors.textStrong else colors.textMuted,
        fontSize = 13.sp,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) colors.bgSelected else colors.bgSurface)
            .clickable(onClickLabel = label, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}
