package fish.nexa.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import fish.nexa.ui.Icon
import fish.nexa.ui.components.NexaMark
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import kotlin.math.cos
import kotlin.math.sin

/** NexaAvatar: the system account's picture, the mark on the accent, lit from the top-start. */
@Composable
fun NexaAvatar(size: Dp) {
    val c = Nx.colors
    val dark = mixSrgb(Color.Black, c.brand, 0.62f)
    Box(
        Modifier
            .size(size)
            .ring(CircleShape, Color.White.copy(alpha = 0.08f))
            .drawBehind {
                // linear-gradient(145deg): from the top-start corner towards the bottom-end
                val a = Math.toRadians(145.0 - 90.0)
                val half = (kotlin.math.abs(this.size.width * cos(a)) + kotlin.math.abs(this.size.height * sin(a))).toFloat() / 2f
                val cx = this.size.width / 2f
                val cy = this.size.height / 2f
                val dx = (cos(a) * half).toFloat()
                val dy = (sin(a) * half).toFloat()
                drawCircle(Brush.linearGradient(listOf(c.brand, dark), Offset(cx - dx, cy - dy), Offset(cx + dx, cy + dy)))
            },
        contentAlignment = Alignment.Center,
    ) {
        NexaMark(c.onBrand, size * 0.58f)
    }
}

/** OfficialBadge: marks the system account so a look-alike name cannot pass for it. */
@Composable
fun OfficialBadge(compact: Boolean) {
    val c = Nx.colors
    val shape = RoundedCornerShape(4.dp)
    if (compact) {
        Box(Modifier.size(18.dp).background(c.brand, shape).semantics { contentDescription = t("nexa.official") }, contentAlignment = Alignment.Center) {
            Icon("BadgeCheck", c.onBrand, size = 12.dp)
        }
    } else {
        Row(
            Modifier.height(18.dp).background(c.brand, shape).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Icon("BadgeCheck", c.onBrand, size = 13.dp)
            Txt(t("nexa.official").uppercase(), style = Nx.type.hint.copy(fontSize = Nx.type.sp(10.5f), fontWeight = FontWeight(700), letterSpacing = 0.04.em), color = c.onBrand)
        }
    }
}
