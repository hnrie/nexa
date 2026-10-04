package fish.nexa.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One library the app ships and its licence (the catalogue android/tools/android_licenses.py writes). */
private data class Pkg(val part: String, val name: String, val version: String, val license: String, val url: String, val copyright: String?)

private class Catalogue(val parts: List<String>, val licenses: Map<String, String>, val packages: List<Pkg>)

private fun readCatalogue(): Catalogue {
    val o = Json.parseToJsonElement(Nexa.app.assets.open("licenses.json").use { it.readBytes().decodeToString() }) as JsonObject
    fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
    val parts = (o["parts"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
    val licenses = (o["licenses"] as? JsonObject)?.mapValues { (_, v) -> (v as? JsonObject)?.s("text") ?: "" } ?: emptyMap()
    val packages = (o["packages"] as? JsonArray)?.mapNotNull { e ->
        val p = e as? JsonObject ?: return@mapNotNull null
        Pkg(p.s("part") ?: "", p.s("name") ?: "", p.s("version") ?: "", p.s("license") ?: "Unknown", p.s("url") ?: "", p.s("copyright"))
    } ?: emptyList()
    return Catalogue(parts, licenses, packages)
}

private fun partName(part: String) = when (part) {
    "android" -> t("shell.downloadBanner.androidApp")
    "server" -> t("settings.licenses.server")
    "assets" -> t("settings.licenses.fontsAndArtwork")
    "web" -> t("settings.licenses.webApp")
    else -> t("settings.licenses.desktopApp")
}

/** 3.23 Licences: every library the app ships, with its licence, searchable. */
@Composable
fun LicensesPage() {
    val c = Nx.colors
    val ctx = LocalContext.current
    val catalogue by produceState<Catalogue?>(null) { value = withContext(Dispatchers.IO) { runCatching { readCatalogue() }.getOrNull() } }
    var q by remember { mutableStateOf("") }
    var part by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }

    PageTitle(t("settings.licenses.licenses"))
    Hint(t("android.settings.licenses.hint"), Modifier.padding(bottom = 14.dp).settingAnchor("licenses"))
    val cat = catalogue
    if (cat == null) {
        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Spinner() }
        return
    }
    NxTextField(q, { q = it }, placeholder = t("settings.licenses.searchPackages"), modifier = Modifier.semantics { contentDescription = t("settings.licenses.searchPackages") })
    Row(Modifier.fillMaxWidth().padding(top = 10.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Chip(t("settings.licenses.everything"), part == null) { part = null }
        for (p in cat.parts) Chip(partName(p), part == p) { part = p }
    }
    val needle = q.trim().lowercase()
    val shown = cat.packages.filter { (part == null || it.part == part) && (needle.isEmpty() || it.name.lowercase().contains(needle) || it.license.lowercase().contains(needle)) }
    if (shown.isEmpty()) {
        Box(Modifier.padding(top = 16.dp)) { EmptyBox(t("settings.licenses.noPackageMatchesThat")) }
        return
    }
    for (p in cat.parts) {
        val list = shown.filter { it.part == p }
        if (list.isEmpty()) continue
        SectionHeading(partName(p), trailing = { StatePill(list.size.toString(), c.textMuted) })
        for (pkg in list) {
            val key = "${pkg.part}/${pkg.name}@${pkg.version}"
            val isOpen = open == key
            Column(Modifier.fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .clip(Radii.Sm)
                        .pressable(remember(key) { MutableInteractionSource() }) { open = if (isOpen) null else key }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Txt(pkg.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = c.text)
                        Txt("${pkg.version} · ${pkg.license}", style = Nx.type.hint, color = c.textMuted)
                    }
                    Icon(if (isOpen) "ChevronUp" else "ChevronDown", c.textMuted, size = 18.dp)
                }
                if (isOpen) Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    pkg.copyright?.let { Txt(it, style = Nx.type.bodySmall, color = c.textSubtle) }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(max = 260.dp)
                            .sunken(Radii.Sm, c)
                            .ring(Radii.Sm, c.borderSubtle)
                            .verticalScroll(rememberScrollState())
                            .padding(12.dp),
                    ) {
                        SelectionContainer { Txt(cat.licenses[pkg.license] ?: pkg.license, style = Nx.type.code.copy(fontSize = Nx.type.sp(11.5f), lineHeight = Nx.type.sp(16f)), color = c.text) }
                    }
                    if (pkg.url.isNotBlank()) NxButton(t("settings.licenses.projectPage"), {
                        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pkg.url))) }
                    }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "ExternalLink")
                }
                Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
            }
        }
    }
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Box(
        Modifier
            .heightIn(min = 36.dp)
            .then(if (on) Modifier.background(c.brand, Radii.Pill) else Modifier.ring(Radii.Pill, c.border).background(c.bgSurface, Radii.Pill))
            .clip(Radii.Pill)
            .pressable(remember { MutableInteractionSource() }, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(label, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = if (on) c.onBrand else c.text, maxLines = 1) }
}
