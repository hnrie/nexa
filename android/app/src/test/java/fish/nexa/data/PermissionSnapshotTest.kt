package fish.nexa.data

import fish.nexa.net.Member
import fish.nexa.net.Role
import fish.nexa.net.Server
import kotlinx.collections.immutable.persistentHashMapOf
import org.junit.Assert.*
import org.junit.Test

class PermissionSnapshotTest {
    @Test fun reusedParsingIsLocalToTheImmutableSnapshot() {
        val member = Member("s", "u")
        val st = ServerState(Server("s"), persistentHashMapOf("s" to Role("s", permissions = P.VIEW_CHANNEL.toString())), persistentHashMapOf("u" to member), 1, member, 0, true)
        assertSame(st.permissionRoles, st.permissionRoles)
        assertEquals(P.VIEW_CHANNEL, Perms.base("s", st.permissionRoles, Perms.member(member, "u"), false))
        val changed = st.copy(roles = st.roles.put("s", Role("s", permissions = P.DEFAULT_EVERYONE.toString())))
        assertEquals(P.DEFAULT_EVERYONE, Perms.base("s", changed.permissionRoles, Perms.member(member, "u"), false))
        assertEquals(P.VIEW_CHANNEL, Perms.base("s", st.permissionRoles, Perms.member(member, "u"), false))
    }
}
