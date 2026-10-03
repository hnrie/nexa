// TEMPORARY: pages still being written in this branch; each is replaced by its own file before it is merged.
package fish.nexa.ui.settings

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import fish.nexa.ui.t

@Composable fun ProfilesPage() = PageTitle(t("settings.profile.profiles"))
@Composable fun BoxScope.ProfilesSaveBar() = Unit

@Composable fun VoicePage() = PageTitle(t("settings.voice.voiceVideo"))
@Composable fun KeybindsPage() = PageTitle(t("keybinds.title"))
@Composable fun ActivityPage() = PageTitle(t("settings.activity.title"))
@Composable fun AboutPage() = PageTitle(t("settings.about.title"))
@Composable fun LicensesPage() = PageTitle(t("settings.licenses.licenses"))
@Composable fun AdminPage() = PageTitle(t("settings.admin.nexaAdmin"))
