package xyz.evilion.chat.ui.pickers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.net.Emoji
import xyz.evilion.chat.net.ExpressionsApi
import xyz.evilion.chat.net.GifResult
import xyz.evilion.chat.net.Sticker
import xyz.evilion.chat.ui.theme.chatColors

/** Unicode emoji, this server's custom ones, and the packs you have installed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmojiPickerSheet(serverId: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val colors = chatColors
    val context = LocalContext.current
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    var ready by remember { mutableStateOf(EmojiIndex.loaded) }
    val emojis by AppState.emojis.collectAsState()
    val packs by AppState.stickerPacks.collectAsState()

    LaunchedEffect(Unit) {
        EmojiIndex.load(context)
        ready = true
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(460.dp)) {
            SearchField(query, { query = it }, t("pickers.emojiPicker.searchEmoji"))
            if (!ready) {
                Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.brand) }
                return@Column
            }
            val custom = buildList {
                serverId?.let { addAll(emojis[it].orEmpty()) }
                for (list in emojis.filterKeys { it != serverId }.values) addAll(list)
            }
            val packEmoji = packs.filter { it.kind == "emoji" && it.installed }.flatMap { it.stickers }
            val recents = SettingsStore.recentEmoji
            LazyVerticalGrid(
                columns = GridCells.Adaptive(46.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
            ) {
                if (query.isBlank() && recents.isNotEmpty()) {
                    header(t("pickers.pickers.recent"))
                    items(recents) { token ->
                        EmojiCell(token) {
                            SettingsStore.rememberEmoji(token)
                            onPick(token)
                        }
                    }
                }
                val matchingCustom = custom.filter { query.isBlank() || it.name.contains(query, true) }
                if (matchingCustom.isNotEmpty()) {
                    header(t("settings.appearance.custom"))
                    items(matchingCustom, key = { it.id }) { emoji ->
                        CustomEmojiCell(emoji) {
                            val token = "<${if (emoji.animated) "a" else ""}:${emoji.name}:${emoji.blobId}>"
                            SettingsStore.rememberEmoji(token)
                            onPick(token)
                        }
                    }
                }
                val matchingPack = packEmoji.filter { query.isBlank() || it.name.contains(query, true) }
                if (matchingPack.isNotEmpty()) {
                    header(t("pickers.pickers.yourPacks"))
                    items(matchingPack, key = { it.id }) { sticker ->
                        PackEmojiCell(sticker) {
                            val token = "<${if (sticker.animated) "a" else ""}:${sticker.name}:${sticker.blobId}>"
                            SettingsStore.rememberEmoji(token)
                            onPick(token)
                        }
                    }
                }
                if (query.isNotBlank()) {
                    val results = EmojiIndex.search(query)
                    if (results.isNotEmpty()) {
                        header(t("modals.customStatus.emoji"))
                        items(results, key = { it.unicode }) { entry ->
                            EmojiCell(EmojiIndex.withTone(entry, SettingsStore.skinTone)) {
                                val value = EmojiIndex.withTone(entry, SettingsStore.skinTone)
                                SettingsStore.rememberEmoji(value)
                                onPick(value)
                            }
                        }
                    }
                } else {
                    for ((id, name) in EmojiIndex.GROUPS) {
                        val list = EmojiIndex.group(id)
                        if (list.isEmpty()) continue
                        header(name)
                        items(list, key = { it.unicode }) { entry ->
                            EmojiCell(EmojiIndex.withTone(entry, SettingsStore.skinTone)) {
                                val value = EmojiIndex.withTone(entry, SettingsStore.skinTone)
                                SettingsStore.rememberEmoji(value)
                                onPick(value)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.grid.LazyGridScope.header(title: String) {
    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
        Text(
            title.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 4.dp),
            color = androidx.compose.ui.graphics.Color(0xFF999AA1),
        )
    }
}

private val CUSTOM_TOKEN = Regex("^<(a)?:([^:]+):(\\d+)>$")

/** One cell: a plain emoji drawn with Twemoji, or a custom one by its picture. */
@Composable
private fun EmojiCell(text: String, onClick: () -> Unit) {
    val custom = remember(text) { CUSTOM_TOKEN.find(text) }
    Box(Modifier.size(46.dp).clickable(onClick = onClick), Alignment.Center) {
        if (custom != null) {
            AsyncImage(
                model = Media.emoji(custom.groupValues[3], 64),
                contentDescription = custom.groupValues[2],
                modifier = Modifier.size(30.dp),
            )
        } else {
            TwemojiImage(text, 30.dp, fallbackSize = 26.sp)
        }
    }
}

@Composable
private fun CustomEmojiCell(emoji: Emoji, onClick: () -> Unit) {
    Box(Modifier.size(46.dp).clickable(onClick = onClick), Alignment.Center) {
        AsyncImage(model = Media.emoji(emoji.blobId, 64), contentDescription = emoji.name, modifier = Modifier.size(30.dp))
    }
}

@Composable
private fun PackEmojiCell(sticker: Sticker, onClick: () -> Unit) {
    Box(Modifier.size(46.dp).clickable(onClick = onClick), Alignment.Center) {
        AsyncImage(model = Media.sticker(sticker.blobId, 64), contentDescription = sticker.name, modifier = Modifier.size(30.dp))
    }
}

/** GIF search, when the instance has a Tenor key. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GifPickerSheet(onDismiss: () -> Unit, onPickGif: (GifResult) -> Unit, onOpenStickers: () -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<GifResult>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(query) {
        loading = true
        error = null
        runCatching {
            results = if (query.isBlank()) ExpressionsApi.gifTrending().results else ExpressionsApi.gifSearch(query).results
        }.onFailure { error = t("pickers.pickers.gifSearchIsNotSetUp") }
        loading = false
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(460.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { SearchField(query, { query = it }, t("pickers.gifPicker.searchGifs")) }
                Spacer(Modifier.width(8.dp))
                Text(
                    t("pickers.expressionPicker.stickers"),
                    color = colors.textBrand,
                    fontSize = 14.sp,
                    modifier = Modifier.clickable(onClick = onOpenStickers).padding(8.dp),
                )
            }
            when {
                loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.brand) }
                error != null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(error!!, color = colors.textMuted, fontSize = 14.sp)
                }
                else -> LazyVerticalStaggeredGrid(
                    columns = StaggeredGridCells.Fixed(2),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
                    verticalItemSpacing = 6.dp,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(results, key = { it.id }) { gif ->
                        AsyncImage(
                            model = gif.preview.ifEmpty { gif.url },
                            contentDescription = gif.title,
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier.fillMaxWidth()
                                .aspectRatio(if (gif.h > 0) (gif.w.toFloat() / gif.h).coerceIn(0.5f, 2f) else 1.3f)
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { onPickGif(gif) },
                        )
                    }
                }
            }
        }
    }
}

/** The sticker packs this account has installed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StickerPickerSheet(onDismiss: () -> Unit, onPick: (Sticker) -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val packs by AppState.stickerPacks.collectAsState()
    var query by remember { mutableStateOf("") }
    val installed = packs.filter { it.kind == "sticker" }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(460.dp)) {
            SearchField(query, { query = it }, t("pickers.stickerPicker.searchStickers"))
            if (installed.isEmpty()) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(t("pickers.pickers.noStickerPacksYet"), color = colors.textMuted, fontSize = 14.sp)
                }
                return@Column
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(84.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
            ) {
                for (pack in installed) {
                    val stickers = pack.stickers.filter { query.isBlank() || it.name.contains(query, true) || it.tags.contains(query, true) }
                    if (stickers.isEmpty()) continue
                    header(pack.name)
                    items(stickers, key = { it.id }) { sticker ->
                        Box(Modifier.size(84.dp).clickable { onPick(sticker) }, Alignment.Center) {
                            AsyncImage(
                                model = Media.sticker(sticker.blobId, 160),
                                contentDescription = sticker.name,
                                modifier = Modifier.size(72.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String) {
    val colors = chatColors
    TextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(placeholder, color = colors.textPlaceholder) },
        singleLine = true,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = colors.bgInput,
            unfocusedContainerColor = colors.bgInput,
            focusedTextColor = colors.text,
            unfocusedTextColor = colors.text,
            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            cursorColor = colors.brand,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(RoundedCornerShape(10.dp)),
    )
}
