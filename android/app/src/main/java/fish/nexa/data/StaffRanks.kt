package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.ui.profile.NexaOwner
import fish.nexa.ui.t

/**
 * lib/staffRank.ts: Nexa's staff ranks, as the server keeps them
 * (internal/api/staff.go), each holding everything the ones below it hold.
 * A mod sees people, cases and the log and mutes or bans for a week at most;
 * an admin does everything in the panel but disabling sign-in and deleting,
 * with no rights in other people's servers; a developer is what Nexa admins
 * have always been (flag 1); the owner is the oldest developer and the only
 * one who gives and takes ranks. A rank is a public flag bit.
 */
enum class StaffRank(val key: String, val icon: String) {
    MOD("mod", "ShieldCheck"),
    ADMIN("admin", "Hammer"),
    DEVELOPER("developer", "CodeXml"),
    OWNER("owner", "Crown");

    fun atLeast(need: StaffRank) = ordinal >= need.ordinal

    val label: String
        get() = when (this) {
            OWNER -> t("profile.profileCard.owner")
            DEVELOPER -> t("staff.rank.developer")
            ADMIN -> t("profile.profileCard.admin")
            MOD -> t("staff.rank.mod")
        }

    /** What the badge says when it is described: "Owner of Nexa". */
    val tip: String
        get() = when (this) {
            OWNER -> t("profile.profileCard.ownerTip")
            DEVELOPER -> t("staff.rank.developerTip")
            ADMIN -> t("profile.profileCard.adminTip")
            MOD -> t("staff.rank.modTip")
        }

    /** What a rank the owner gives can do, in a line. */
    val powers: String
        get() = when (this) {
            DEVELOPER -> t("staff.rank.developerPowers")
            ADMIN -> t("staff.rank.adminPowers")
            else -> t("staff.rank.modPowers")
        }
}

object StaffRanks {
    const val DEVELOPER = 1L
    const val ADMIN = 256L
    const val MOD = 512L
    const val ALL = DEVELOPER or ADMIN or MOD

    /** The longest mute or ban a mod can give. */
    const val MOD_MAX_MS = 7L * 24 * 60 * 60 * 1000

    /** Someone's rank from their flags, null for none. The owner's account always reads as the owner. */
    fun of(userId: String?, flags: Long, ownerId: String? = null): StaffRank? = when {
        userId != null && userId == (ownerId ?: NexaOwner.id()) -> StaffRank.OWNER
        flags and DEVELOPER != 0L -> StaffRank.DEVELOPER
        flags and ADMIN != 0L -> StaffRank.ADMIN
        flags and MOD != 0L -> StaffRank.MOD
        else -> null
    }

    /** The signed-in account's rank. */
    fun mine(): StaffRank? = Nexa.users.me.value?.let { of(it.id, it.flags) }
}

/** Whether a rank (or none) is need or above it. */
fun StaffRank?.atLeast(need: StaffRank) = this != null && this.atLeast(need)
