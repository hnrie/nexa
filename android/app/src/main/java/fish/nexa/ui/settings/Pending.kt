// TEMPORARY: pages still being written in this branch; each is replaced by its own file before it is merged.
package fish.nexa.ui.settings

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import fish.nexa.ui.t

@Composable fun AccountPage(openPage: (String, String?) -> Unit) = PageTitle(t("settings.account.myAccount"))
@Composable fun ProfilesPage() = PageTitle(t("settings.profile.profiles"))
@Composable fun BoxScope.ProfilesSaveBar() = Unit
@Composable fun SecurityPage() = PageTitle(t("settings.security.security"))
@Composable fun DevicesPage() = PageTitle(t("settings.devices.devices"))
@Composable fun SoundsPage() = PageTitle(t("settings.sounds.title"))
@Composable fun StickersPage() = PageTitle(t("settings.groups.emojiStickers"))
@Composable fun AppearancePage() = PageTitle(t("settings.appearance.appearance"))
@Composable fun VoicePage() = PageTitle(t("settings.voice.voiceVideo"))
@Composable fun KeybindsPage() = PageTitle(t("keybinds.title"))
@Composable fun ActivityPage() = PageTitle(t("settings.activity.title"))
@Composable fun AboutPage() = PageTitle(t("settings.about.title"))
@Composable fun LicensesPage() = PageTitle(t("settings.licenses.licenses"))
@Composable fun AdminPage() = PageTitle(t("settings.admin.nexaAdmin"))
