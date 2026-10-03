package fish.nexa.ui.chat

/** The safety number, from the key chip in a DM's header. */
fun openVerifyKey(userId: String) = fish.nexa.ui.profile.KeyDialogs.openVerify(userId)

/** The whole topic, from the line of it in a channel's header. */
fun openChannelTopic(channel: fish.nexa.net.Channel) = fish.nexa.ui.dialogs.Dialogs.channelTopic(channel.id)
