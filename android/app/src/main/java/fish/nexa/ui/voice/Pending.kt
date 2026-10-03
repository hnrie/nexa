// TEMPORARY: replaced by the real call status before release.
package fish.nexa.ui.voice

import androidx.compose.runtime.Composable

@Composable fun VoiceStatus() {}
@Composable fun VoiceChannelPage(channel: fish.nexa.net.Channel) = fish.nexa.ui.shell.PageHeader(channel.name)
