package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Sticker
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors

const val TAB_EMOJI = 0
const val TAB_GIF = 1
const val TAB_STICKER = 2

/** What the sheet is being opened for. */
sealed interface ExpressionMode {
    /** Writing a message: emoji insert and the sheet stays open; GIFs and stickers send. */
    data object Compose : ExpressionMode

    /**
     * Adding a reaction to a message. Only emoji: a reaction in this product is
     * a string key, so a GIF or a sticker cannot be one — they are absent
     * rather than shown greyed out.
     */
    data class Reaction(val authorName: String) : ExpressionMode
}

/**
 * One picker for emoji, GIFs and stickers.
 *
 * There used to be three unrelated bottom sheets, reachable only through each
 * other: the GIF button vanished the moment you typed a character, and the only
 * way to a sticker was a word "Stickers" drawn inside the GIF sheet. This is
 * one sheet with three tabs, opened by one button, which is what the web client
 * has always done.
 *
 * Insets: `ModalBottomSheet` applies its own, so they are turned off here and
 * placed once, by the single spacer at the bottom of the column. Padding the
 * whole column instead — or adding `imePadding()` — fights the sheet's own
 * height animation, which is where this app's inset bugs have come from before.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExpressionSheet(
    serverId: String?,
    onDismiss: () -> Unit,
    onEmoji: (String) -> Unit,
    mode: ExpressionMode = ExpressionMode.Compose,
    initialTab: Int = TAB_EMOJI,
    onSticker: (Sticker) -> Unit = {},
    onGif: (GifPick) -> Unit = {},
) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val reaction = mode as? ExpressionMode.Reaction
    val state = rememberExpressionState()
    val settings by SettingsStore.doc.collectAsState()
    val instance by AppState.instance.collectAsState()
    val packs by AppState.stickerPacks.collectAsState()

    val confirmedGifs by GifStatus.enabled.collectAsState()

    val tone = Expressions.skinTone(settings)
    val favorites = remember(Expressions.favoritesKey(settings)) { Expressions.favorites(settings) }
    val gifEnabled = confirmedGifs ?: instance?.gifSearch ?: false
    val hasGifs = gifEnabled || favorites.isNotEmpty()

    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val pages = if (reaction != null) 1 else 3
    val pager = rememberPagerState(initialPage = if (reaction != null) TAB_EMOJI else initialTab) { pages }
    val tab = pager.currentPage

    // the composer's keyboard goes down, so the sheet is not opening under it
    LaunchedEffect(Unit) {
        keyboard?.hide()
        GifStatus.confirm()
    }

    // 62 % of the window, as the web's mobile rule is 60vh, with a floor so a
    // short phone still gets a usable grid and a cap so a landscape one is not
    // handed a sheet taller than its own screen. Measured out here, against the
    // activity's window: inside the sheet this would be the sheet's own size.
    val windowHeight = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
    val sheetHeight = (windowHeight * 0.62f)
        .coerceIn(380.dp, 560.dp)
        .coerceAtMost((windowHeight - 88.dp).coerceAtLeast(240.dp))

    fun pick(p: Pick) {
        Expressions.remember(p)
        if (reaction != null) {
            onEmoji(Expressions.reactionKey(p))
            onDismiss()
        } else {
            // the sheet stays open, so several emoji can go in at once
            onEmoji(Expressions.token(p))
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = colors.bgFloating,
        contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
        sheetMaxWidth = 560.dp,
        dragHandle = { BottomSheetDefaults.DragHandle() },
    ) {
        // The keyboard raises the whole sheet rather than eating the grid: the
        // bottom spacer consumes `navigationBars ∪ ime` and the column grows by
        // the same amount, capped by the window. Consuming it without growing
        // leaves a 380 dp sheet with a 300 dp keyboard nothing to draw a grid
        // in; `imePadding()` on the column would fight the sheet's own height
        // animation, which is where this app's inset bugs have come from.
        val ime = with(LocalDensity.current) { WindowInsets.ime.getBottom(this).toDp() }
        Column(
            Modifier
                .fillMaxWidth()
                .height((sheetHeight + ime).coerceAtMost(windowHeight - 24.dp))
                .semantics { paneTitle = t("pickers.expressionPicker.expressionPicker") },
        ) {
            if (reaction != null) {
                ReactionTitle(reaction.authorName)
                QuickReactions(settings, tone) { pick(it) }
            } else {
                ExpressionTabs(tab, hasGifs) { scope.launch { pager.animateScrollToPage(it) } }
            }

            if (tab != TAB_GIF || gifEnabled) {
                SearchRow(
                    value = state.queryFor(tab),
                    onChange = { state.setQuery(tab, it) },
                    placeholder = when (tab) {
                        TAB_GIF -> t("pickers.gifPicker.searchGifs")
                        TAB_STICKER -> t("pickers.stickerPicker.searchStickers")
                        else -> t("pickers.emojiPicker.searchEmoji")
                    },
                    trailing = { if (tab == TAB_EMOJI) SkinToneButton(tone) },
                )
            }

            HorizontalPager(
                state = pager,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                beyondViewportPageCount = 0,
                userScrollEnabled = reaction == null,
            ) { page ->
                when (page) {
                    TAB_GIF -> GifTab(state, settings, gifEnabled) { gif ->
                        onGif(gif)
                        onDismiss()
                    }
                    TAB_STICKER -> StickerTab(state, packs, serverId) { sticker ->
                        onSticker(sticker)
                        onDismiss()
                    }
                    else -> EmojiTab(state, settings, serverId, tone) { pick(it) }
                }
            }

            ExpressionFooter(state, tab, reaction != null)

            // the one place insets are applied: above the gesture bar, and above
            // the keyboard when it is up
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars.union(WindowInsets.ime)))
        }
    }
}

/** Emoji · GIFs · Stickers. A tab whose feature the instance turned off is disabled, not hidden. */
@Composable
private fun ExpressionTabs(selected: Int, hasGifs: Boolean, onSelect: (Int) -> Unit) {
    val colors = chatColors
    SecondaryTabRow(
        selectedTabIndex = selected,
        containerColor = colors.bgFloating,
        contentColor = colors.textStrong,
    ) {
        TabButton(t("modals.customStatus.emoji"), selected == TAB_EMOJI, true) { onSelect(TAB_EMOJI) }
        TabButton(t("pickers.expressionPicker.gifs"), selected == TAB_GIF, hasGifs) { onSelect(TAB_GIF) }
        TabButton(t("pickers.expressionPicker.stickers"), selected == TAB_STICKER, true) { onSelect(TAB_STICKER) }
    }
}

@Composable
private fun TabButton(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val colors = chatColors
    Tab(
        selected = selected,
        enabled = enabled,
        onClick = onClick,
        modifier = Modifier.height(48.dp),
        selectedContentColor = colors.textStrong,
        unselectedContentColor = colors.textMuted,
    ) {
        Text(label, fontSize = 14.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

/** In reaction mode the tabs make no sense; this says what the sheet is for. */
@Composable
private fun ReactionTitle(authorName: String) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            t("chat.reactions.addReaction"),
            color = colors.textStrong,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text(authorName, color = colors.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * The six reactions offered straight away: what you used last, then the
 * defaults. It used to live in the message actions sheet; here it belongs to
 * the picker and can be reused wherever a reaction is added.
 */
@Composable
private fun QuickReactions(
    settings: kotlinx.serialization.json.JsonObject,
    tone: Int,
    onPick: (Pick) -> Unit,
) {
    val recents = remember(Expressions.recentKey(settings)) {
        (Expressions.recentUnicode(settings).take(4) + Expressions.QUICK).distinct().take(6)
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (base in recents) {
            val entry = EmojiIndex.byText(base)
            val text = if (entry != null) EmojiIndex.withTone(entry, tone) else base
            val label = entry?.let { ":${it.shortcode}:" } ?: text
            Box(
                Modifier.size(44.dp).clickable(
                    onClickLabel = label,
                    role = Role.Button,
                ) { onPick(Pick.Unicode(base, text)) },
                Alignment.Center,
            ) {
                TwemojiImage(text, 30.dp, fallbackSize = 26.sp)
            }
        }
    }
}

/**
 * The search box.
 *
 * It never takes focus on open. A phone that raised its keyboard here would
 * cover the very grid it was opened to show, which is why the web client only
 * autofocuses on a fine pointer.
 */
@Composable
private fun SearchRow(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    trailing: @Composable () -> Unit = {},
) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(placeholder, color = colors.textPlaceholder, fontSize = 14.sp) },
            leadingIcon = { Icon(Lucide.Search, null, tint = colors.icon, modifier = Modifier.size(18.dp)) },
            trailingIcon = if (value.isEmpty()) null else {
                {
                    Icon(
                        Lucide.X,
                        t("chat.attachments.close"),
                        tint = colors.icon,
                        modifier = Modifier.size(18.dp).clickable { onChange("") },
                    )
                }
            },
            singleLine = true,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = colors.bgInput,
                unfocusedContainerColor = colors.bgInput,
                focusedTextColor = colors.text,
                unfocusedTextColor = colors.text,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = colors.brand,
            ),
            modifier = Modifier.weight(1f).clip(RoundedCornerShape(10.dp)),
        )
        trailing()
    }
}

/**
 * The skin tone menu.
 *
 * New on Android: `skinTone` was read by the old picker and never written, so
 * the only way to change it on the phone was to open the web client.
 */
@Composable
private fun SkinToneButton(tone: Int) {
    val colors = chatColors
    var open by remember { mutableStateOf(false) }
    val names = Expressions.toneNames()
    Box {
        Box(
            Modifier
                .size(48.dp)
                .clickable(
                    onClickLabel = t("pickers.emojiPicker.skinToneNamed", "tone" to names[tone]),
                    role = Role.Button,
                ) { open = true },
            Alignment.Center,
        ) {
            TwemojiImage(Expressions.TONE_HANDS[tone], 22.dp, fallbackSize = 20.sp)
        }
        // a Popup takes Back before the sheet does, so Back closes this first
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = colors.bgFloating) {
            names.forEachIndexed { index, name ->
                DropdownMenuItem(
                    text = { Text(name, color = if (index == tone) colors.textStrong else colors.text, fontSize = 14.sp) },
                    leadingIcon = { TwemojiImage(Expressions.TONE_HANDS[index], 22.dp, fallbackSize = 20.sp) },
                    onClick = {
                        Expressions.setSkinTone(index)
                        open = false
                    },
                    modifier = Modifier.semantics {
                        role = Role.RadioButton
                        selected = index == tone
                        contentDescription = t("pickers.emojiPicker.skinToneNamed", "tone" to name)
                    },
                )
            }
        }
    }
}

/**
 * The strip under the grid.
 *
 * On the emoji tab it answers "what am I about to send": while a cell is held
 * it shows that emoji and its `:shortcode:`, and otherwise the category you are
 * looking at. On the GIF tab it carries the provider's line and the errors that
 * must not throw away what is already on screen.
 */
@Composable
private fun ExpressionFooter(state: ExpressionState, tab: Int, reactionMode: Boolean) {
    val colors = chatColors
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .background(colors.bgFloating)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (tab) {
            TAB_GIF -> GifFooter(state)
            TAB_STICKER -> Unit
            else -> {
                val held = state.pressed
                if (held != null) {
                    PickImage(held.pick, 24.dp, held.label, animate = true)
                    Spacer(Modifier.width(8.dp))
                    Text(held.label, color = colors.textStrong, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else {
                    Text(
                        if (reactionMode) t("pickers.expressionPicker.tapAnEmojiToReact") else state.footerCategory,
                        color = colors.textMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
