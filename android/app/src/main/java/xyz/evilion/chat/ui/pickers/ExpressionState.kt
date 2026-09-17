package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridState
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import xyz.evilion.chat.data.ServerState
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Emoji
import xyz.evilion.chat.net.StickerPack

/** What a rail button draws: a clock, a server's icon, a pack's cover, or a category. */
enum class RailKind { RECENT, SERVER, PACK, GROUP }

data class RailIcon(
    val kind: RailKind,
    /** For RECENT and GROUP: the emoji that stands for it. */
    val emoji: String? = null,
    val serverId: String? = null,
    val name: String = "",
    val iconId: String? = null,
    /** For PACK: the blob of the cover picture. */
    val blobId: String? = null,
)

/** One tappable thing in the emoji grid. */
data class EmojiCell(val key: String, val pick: Pick, val label: String, val animated: Boolean = false)

/** A titled run of cells: recents, a server's emoji, a pack, or a unicode category. */
data class EmojiSection(
    val key: String,
    val title: String,
    val rail: RailIcon,
    val cells: List<EmojiCell>,
    val showHeader: Boolean = true,
)

/**
 * The emoji grid, laid out.
 *
 * [headerIndices] is where each section's header sits in the lazy grid's item
 * indices — a full-span header is one item and each cell is one item, so this
 * is exact whatever the column count. The sticky header overlay and the
 * category rail both read it, which is the point: two independently computed
 * index maps drift, one does not.
 */
@Stable
class EmojiLayout(val sections: List<EmojiSection>, val loading: Boolean = false, val failed: Boolean = false) {
    val headerIndices: IntArray = IntArray(sections.size).also { out ->
        var index = 0
        sections.forEachIndexed { i, section ->
            out[i] = index
            index += (if (section.showHeader) 1 else 0) + section.cells.size
        }
    }

    val isEmpty: Boolean get() = sections.all { it.cells.isEmpty() }

    /** The section a lazy-grid item index falls in: the last header at or before it. */
    fun sectionAt(itemIndex: Int): Int {
        if (headerIndices.isEmpty()) return 0
        var low = 0
        var high = headerIndices.size - 1
        var found = 0
        while (low <= high) {
            val mid = (low + high) / 2
            if (headerIndices[mid] <= itemIndex) {
                found = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return found
    }

    companion object {
        val Loading = EmojiLayout(emptyList(), loading = true)
    }
}

/** A GIF the grid is drawing, from a search or from the favourites list. */
data class GifTile(val key: String, val gif: GifPick, val title: String, val preview: String)

/** Which list of GIFs is showing. */
enum class GifMode { FAVORITES, SEARCH }

/**
 * Everything the sheet keeps while it is open.
 *
 * A plain `@Stable` class rather than a ViewModel: this app has none and should
 * not grow one for a bottom sheet. Each tab keeps its own query and its own
 * scroll position, so swiping between them does not throw away what you typed.
 */
@Stable
class ExpressionState(
    val emojiGrid: LazyGridState,
    val emojiRail: LazyListState,
    val stickerGrid: LazyGridState,
    val stickerRail: LazyListState,
    val gifGrid: LazyStaggeredGridState,
) {
    var emojiQuery by mutableStateOf("")
    var gifQuery by mutableStateOf("")
    var stickerQuery by mutableStateOf("")

    /**
     * What is under the finger, for the footer.
     *
     * Only the footer reads it, so pressing a cell does not recompose the two
     * thousand others — the same reason the web keeps its inspector in an
     * external store rather than in React state.
     */
    var pressed by mutableStateOf<EmojiCell?>(null)

    /** The emoji category the grid is currently showing, for the rail and the footer. */
    var activeSection by mutableStateOf(0)

    /** Its name, which the footer shows when nothing is being held. */
    var footerCategory by mutableStateOf("")

    // --- the GIF tab, which has to survive a tab swipe -----------------------
    /** Null until a chip is tapped, so the tab can open where the web opens. */
    var gifMode by mutableStateOf<GifMode?>(null)
    var gifResults by mutableStateOf<List<GifTile>>(emptyList())
    var gifCursor by mutableStateOf("")

    /** The query the results on screen belong to; null while nothing has been asked for. */
    var gifShownFor by mutableStateOf<String?>(null)
    var gifLoading by mutableStateOf(false)
    var gifPaging by mutableStateOf(false)

    /** A first page that never arrived — a network failure, not "the server has no provider". */
    var gifFailed by mutableStateOf(false)
    var gifPageFailed by mutableStateOf(false)

    /** Favourites whose picture no longer loads, so they can be named and removed. */
    var deadGifs by mutableStateOf<Set<String>>(emptySet())

    fun queryFor(tab: Int): String = when (tab) {
        TAB_GIF -> gifQuery
        TAB_STICKER -> stickerQuery
        else -> emojiQuery
    }

    fun setQuery(tab: Int, value: String) {
        when (tab) {
            TAB_GIF -> gifQuery = value
            TAB_STICKER -> stickerQuery = value
            else -> emojiQuery = value
        }
    }
}

@Composable
fun rememberExpressionState(): ExpressionState {
    val emojiGrid = rememberLazyGridState()
    val emojiRail = rememberLazyListState()
    val stickerGrid = rememberLazyGridState()
    val stickerRail = rememberLazyListState()
    val gifGrid = rememberLazyStaggeredGridState()
    return remember { ExpressionState(emojiGrid, emojiRail, stickerGrid, stickerRail, gifGrid) }
}

/**
 * The emoji grid, built once off the main thread.
 *
 * Order is the web client's: frequently used, then one section per server that
 * has custom emoji with the server you are in first, then one per emoji pack
 * newest first, then the nine unicode categories. A query collapses all of it
 * into one flat, scored list.
 */
fun buildEmojiLayout(
    query: String,
    tone: Int,
    recents: List<Pick>,
    emojis: Map<String, List<Emoji>>,
    servers: Map<String, ServerState>,
    packs: List<StickerPack>,
    serverId: String?,
): EmojiLayout {
    val emojiPacks = Expressions.emojiPacks(packs)
    val q = EmojiIndex.normalize(query)

    if (q.isNotEmpty()) {
        val cells = mutableListOf<EmojiCell>()
        for (emoji in searchCustomEmoji(emojis, q, 40)) {
            cells += cellFor(Pick.Custom(emoji.name, emoji.blobId, emoji.animated), "c:${emoji.id}")
        }
        for ((sticker, pack) in searchPackEmoji(emojiPacks, q, 40)) {
            cells += cellFor(Pick.Custom(sticker.name, sticker.blobId, sticker.animated), "k:${pack.id}:${sticker.id}")
        }
        for (entry in EmojiIndex.search(q, 100)) {
            cells += cellFor(entry, tone, "u:${entry.unicode}")
        }
        return EmojiLayout(
            listOf(
                EmojiSection(
                    key = "results",
                    title = t("pickers.emojiPicker.searchEmoji"),
                    rail = RailIcon(RailKind.GROUP, emoji = "🔣"),
                    cells = cells,
                    showHeader = false,
                ),
            ),
        )
    }

    val sections = mutableListOf<EmojiSection>()

    if (recents.isNotEmpty()) {
        sections += EmojiSection(
            key = "recent",
            title = t("pickers.emojiPicker.frequentlyUsed"),
            rail = RailIcon(RailKind.RECENT, emoji = "🕒"),
            cells = recents.mapIndexed { i, pick ->
                // a recent that is also in a category must not share its key
                cellFor(pick, "r:$i:${Expressions.token(pick)}")
            },
        )
    }

    val serverIds = buildList {
        if (serverId != null && !emojis[serverId].isNullOrEmpty()) add(serverId)
        addAll(emojis.keys.filter { it != serverId && !emojis[it].isNullOrEmpty() })
    }
    for (id in serverIds) {
        val list = emojis[id].orEmpty()
        val server = servers[id]?.server
        sections += EmojiSection(
            key = "s:$id",
            title = server?.name?.takeIf { it.isNotEmpty() } ?: t("settings.appearance.custom"),
            rail = RailIcon(RailKind.SERVER, serverId = id, name = server?.name.orEmpty(), iconId = server?.iconId),
            cells = list.map { cellFor(Pick.Custom(it.name, it.blobId, it.animated), "c:${it.id}") },
        )
    }

    for (pack in emojiPacks) {
        val cover = pack.stickers.firstOrNull { it.id == pack.coverStickerId } ?: pack.stickers.firstOrNull()
        sections += EmojiSection(
            key = "p:${pack.id}",
            title = pack.name.ifEmpty { t("pickers.pickers.yourPacks") },
            rail = RailIcon(RailKind.PACK, name = pack.name, blobId = cover?.blobId),
            cells = pack.stickers.map {
                cellFor(Pick.Custom(it.name, it.blobId, it.animated), "k:${pack.id}:${it.id}")
            },
        )
    }

    for ((id, name) in EmojiIndex.groups()) {
        val list = EmojiIndex.group(id)
        if (list.isEmpty()) continue
        sections += EmojiSection(
            key = "g:$id",
            title = name,
            rail = RailIcon(RailKind.GROUP, emoji = EmojiIndex.GROUP_ICONS[id], name = name),
            cells = list.map { cellFor(it, tone, "u:${it.unicode}") },
        )
    }

    return EmojiLayout(sections, failed = EmojiIndex.loadFailed)
}

private fun cellFor(entry: EmojiEntry, tone: Int, key: String): EmojiCell {
    val text = EmojiIndex.withTone(entry, tone)
    return EmojiCell(key, Pick.Unicode(entry.unicode, text), ":${entry.shortcode}:")
}

private fun cellFor(pick: Pick, key: String): EmojiCell = when (pick) {
    is Pick.Custom -> EmojiCell(key, pick, ":${pick.name}:", pick.animated)
    is Pick.Unicode -> EmojiCell(
        key,
        pick,
        EmojiIndex.byText(pick.base)?.let { ":${it.shortcode}:" } ?: pick.text,
    )
}

/** Custom server emoji by name, scored as `searchCustomEmoji` in the web's store. */
fun searchCustomEmoji(emojis: Map<String, List<Emoji>>, query: String, limit: Int): List<Emoji> {
    val q = EmojiIndex.normalize(query)
    if (q.isEmpty()) return emptyList()
    val scored = mutableListOf<Pair<Emoji, Int>>()
    for (list in emojis.values) for (e in list) {
        val n = e.name.lowercase()
        val s = when {
            n == q -> 100
            n.startsWith(q) -> 80
            n.contains(q) -> 40
            else -> -1
        }
        if (s >= 0) scored += e to s
    }
    return scored.sortedWith(compareByDescending<Pair<Emoji, Int>> { it.second }.thenBy { it.first.name })
        .take(limit).map { it.first }
}

/** Emoji out of emoji packs by name, scored as `searchPackEmoji` in the web's store. */
fun searchPackEmoji(packs: List<StickerPack>, query: String, limit: Int): List<Pair<xyz.evilion.chat.net.Sticker, StickerPack>> {
    val q = EmojiIndex.normalize(query)
    if (q.isEmpty()) return emptyList()
    val scored = mutableListOf<Triple<xyz.evilion.chat.net.Sticker, StickerPack, Int>>()
    for (pack in packs) for (sticker in pack.stickers) {
        val n = sticker.name.lowercase()
        val s = when {
            n == q -> 100
            n.startsWith(q) -> 80
            n.contains(q) -> 40
            else -> -1
        }
        if (s >= 0) scored += Triple(sticker, pack, s)
    }
    return scored.sortedByDescending { it.third }.take(limit).map { it.first to it.second }
}

/** Stickers by name, then tag prefix, then pack name — `searchStickers` in the web's store. */
fun searchStickers(packs: List<StickerPack>, query: String, limit: Int = 60): List<Pair<xyz.evilion.chat.net.Sticker, StickerPack>> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return emptyList()
    val scored = mutableListOf<Triple<xyz.evilion.chat.net.Sticker, StickerPack, Int>>()
    for (pack in packs) for (sticker in pack.stickers) {
        val name = sticker.name.lowercase()
        val tags = sticker.tags.lowercase()
        val s = when {
            name == q -> 100
            name.startsWith(q) -> 80
            name.contains(q) -> 50
            tags.split(' ', '\t', '\n').any { it.isNotEmpty() && it.startsWith(q) } -> 40
            pack.name.lowercase().contains(q) -> 20
            else -> -1
        }
        if (s >= 0) scored += Triple(sticker, pack, s)
    }
    return scored.sortedByDescending { it.third }.take(limit).map { it.first to it.second }
}
