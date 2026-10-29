package fish.nexa.ui.shell

import fish.nexa.net.Channel
import org.junit.Assert.assertEquals
import org.junit.Test

class ChannelTreeTest {
    @Test fun preservesNumericOrderOrphansEmptyCategoriesAndServerBoundaries() {
        val all = listOf(
            Channel("20", type = "category", serverId = "s", position = 2),
            Channel("3", type = "category", serverId = "s", position = 1),
            Channel("10", type = "text", serverId = "s", parentId = "3", position = 0),
            Channel("9", type = "text", serverId = "s", parentId = "3", position = 0),
            Channel("7", type = "text", serverId = "s", parentId = "missing"),
            Channel("8", type = "text", serverId = "s"),
            Channel("11", type = "thread", serverId = "s", parentId = "9"),
            Channel("12", type = "text", serverId = "other", parentId = "3"),
        )
        val tree = ChannelTree.of("s", all)
        assertEquals(listOf("7", "8"), tree.loose.map { it.id })
        assertEquals(listOf("3", "20"), tree.categories.map { it.channel.id })
        assertEquals(listOf("9", "10"), tree.categories[0].children.map { it.id })
        assertEquals(emptyList<Channel>(), tree.categories[1].children)
    }
}
