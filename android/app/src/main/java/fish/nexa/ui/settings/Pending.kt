// TEMPORARY: replaced by the real settings screens before release.
package fish.nexa.ui.settings

import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.openSheet

object Settings { fun open() = openSheet("settings", title = "User Settings") { Txt("User Settings") } }
