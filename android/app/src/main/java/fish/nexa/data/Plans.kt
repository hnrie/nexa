package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.Billing
import fish.nexa.net.PlanLimits
import fish.nexa.net.PlansInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex

/**
 * The plans (the web's lib/plans.ts, the server's api/billing.go): what each
 * allows, the account's own, and its side of the subscription once read. A
 * plan only raises what costs money to keep; everything else is the same.
 */
object Plans {
    val PAID = listOf("supporter", "pro")

    /** The name effects only plans have (store.PaidNameEffects). */
    val PAID_EFFECTS = setOf("holo", "neon", "flame")

    /** The table the instance answered with, or the built-in one before it has. */
    fun info(): PlansInfo {
        val inst = Nexa.auth.instance.value
        return inst?.plans ?: PlansInfo(free = PlanLimits(fileMax = inst?.maxUploadBytes ?: (100L shl 20)))
    }

    fun mine(): String = Nexa.users.me.value?.plan ?: ""

    fun limitsOf(plan: String?): PlanLimits = info().let { if (plan == "pro") it.pro else if (plan == "supporter") it.supporter else it.free }

    fun myLimits(): PlanLimits = limitsOf(mine())

    fun boosted(serverId: String?): Boolean = serverId != null && (Nexa.servers.get(serverId)?.server?.boosts ?: 0) > 0

    /** The largest file this account may send to a channel: its plan's, or a boosted server's when that is more. */
    fun fileMaxIn(channelId: String?): Long {
        val own = myLimits().fileMax
        val serverId = channelId?.let { Nexa.channels.get(it)?.serverId }
        return if (boosted(serverId)) maxOf(own, info().boostFileMax) else own
    }

    /** What this account's plan lets a screen share do. */
    fun shareAllowance(): fish.nexa.voice.VideoCap.Allowance = myLimits().let { fish.nexa.voice.VideoCap.Allowance(it.shareQuality, it.shareMaxBps.toInt()) }

    /** The cheapest plan that sends a file this big, or null when none does. */
    fun planForFile(size: Long): String? = PAID.firstOrNull { limitsOf(it).fileMax >= size }

    /** Whether a plan is offered for a file this big: one would send it, and this account is not on the biggest. */
    fun offersFor(size: Long): Boolean = planForFile(size) != null && mine() != "pro"

    private val _billing = MutableStateFlow<Billing?>(null)
    /** The account's side of its subscription (GET /billing), once read. */
    val billing: StateFlow<Billing?> = _billing
    private val loading = Mutex()

    /** Reads it again; the Support page and the tray's meter ask, and billing_update. */
    suspend fun load() {
        if (!loading.tryLock()) return
        try {
            _billing.value = Nexa.api.get("/billing", Billing.serializer())
        } catch (_: Exception) {
        } finally {
            loading.unlock()
        }
    }

    fun clear() {
        _billing.value = null
    }

    /** Why a plan is offered: something the account's plan stopped (the web's stores/upsell.ts). */
    sealed interface Offer {
        data class File(val name: String, val size: Long) : Offer
        data object Uploads : Offer
        data object Share : Offer
        data object Effect : Offer
    }

    private val _offer = MutableStateFlow<Offer?>(null)
    /** The offer on screen (ui/support/Upsell.kt draws it), or null. */
    val offered: StateFlow<Offer?> = _offer

    /** Offers a plan where the free one stopped something; the sheet says what and which plan would do it. */
    fun offer(o: Offer) {
        _offer.value = o
    }

    /** Someone to start Gift a Plan with picked (a profile's Gift a Plan); read once by the Support page. */
    var giftTo: String? = null

    fun dismissOffer() {
        _offer.value = null
    }
}
