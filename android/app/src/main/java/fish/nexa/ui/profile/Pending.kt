// TEMPORARY: replaced by the real profile popout and full profile before release.
package fish.nexa.ui.profile

import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.openSheet

object Profiles { fun open(userId: String) = openSheet("profile", title = "Profile") { Txt(userId) } }
