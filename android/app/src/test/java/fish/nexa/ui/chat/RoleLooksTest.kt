package fish.nexa.ui.chat

import fish.nexa.data.ServerState
import fish.nexa.net.Member
import fish.nexa.net.Role
import fish.nexa.net.Server
import kotlinx.collections.immutable.PersistentMap
import kotlinx.collections.immutable.persistentHashMapOf
import kotlinx.collections.immutable.toPersistentHashMap
import org.junit.Assert.*
import org.junit.Test

class RoleLooksTest {
    private class CountedMembers(private val backing: PersistentMap<String, Member>) : PersistentMap<String, Member> by backing {
        var hashes = 0
        override fun hashCode(): Int { hashes++; return backing.hashCode() }
    }

    @Test fun largeServerLookupsDoNotHashTheMemberRoster() {
        val members = CountedMembers((1..10_000).associate { "$it" to Member("s", "$it", roleIds = listOf("r")) }.toPersistentHashMap())
        val role = Role("r", color = 0x123456, position = 1)
        val st = ServerState(Server("s"), persistentHashMapOf("r" to role), members, members.size, members["1"]!!, 0, true)
        val start = System.nanoTime()
        repeat(500) { assertNotNull(RoleLooks.of(st, "${it + 1}")) }
        println("10k members, 500 name lookups: ${(System.nanoTime() - start) / 1_000_000}ms; roster hashes: ${members.hashes}")
        assertEquals("A name lookup must only visit that member's roles", 0, members.hashes)
    }

    @Test fun followsRoleAndMembershipChangesWithoutStaleLooks() {
        val low = Role("low", color = 0x123456, position = 1, iconEmoji = "a")
        val high = Role("high", color = 0x654321, color2 = 0x111111, color3 = 0x222222, position = 2, iconEmoji = "b")
        val me = Member("s", "u", roleIds = listOf("low", "high"))
        val st = ServerState(Server("s"), persistentHashMapOf("low" to low, "high" to high), persistentHashMapOf("u" to me), 1, me, 0, true)
        val look = RoleLooks.of(st, "u")!!
        assertTrue(look.shimmer)
        assertEquals(3, look.colors!!.size)
        assertEquals(RoleIconInfo.Emoji("b", ""), look.icon)
        assertEquals(RoleIconInfo.Emoji("a", ""), RoleLooks.of(st.copy(roles = st.roles.remove("high")), "u")!!.icon)
        assertNull(RoleLooks.of(st.copy(members = st.members.put("u", me.copy(roleIds = emptyList()))), "u"))
        assertNull(RoleLooks.of(st, "absent"))
        assertNull(RoleLooks.of(null, "u"))
    }
}
