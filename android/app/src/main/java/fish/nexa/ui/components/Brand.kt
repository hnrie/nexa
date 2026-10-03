package fish.nexa.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.ui.theme.Nx

private fun parse(d: String) = PathParser().parsePathString(d).toNodes()

/** The Nexa mark, in the colour of the text around it. */
@Composable
fun NexaMark(color: Color, size: Dp = 24.dp, modifier: Modifier = Modifier) {
    val v = remember(color) {
        ImageVector.Builder("mark", 24.dp, 24.dp, 24f, 24f)
            .addPath(parse(BrandPaths.MARK), fill = SolidColor(color), pathFillType = PathFillType.EvenOdd)
            .build()
    }
    Image(rememberVectorPainter(v), contentDescription = null, modifier = modifier.size(size))
}

/** The wordmark: letters in the text colour, the sparkles in the accent. */
@Composable
fun NexaWordmark(height: Dp = 38.dp, modifier: Modifier = Modifier, letters: Color = Nx.colors.textStrong, spark: Color = Nx.colors.brand) {
    val v = remember(letters, spark) {
        ImageVector.Builder("wordmark", 229.45.dp, 100.dp, 229.45f, 100f)
            .addPath(parse(BrandPaths.WORDMARK_LETTERS), fill = SolidColor(letters), pathFillType = PathFillType.EvenOdd)
            .addPath(parse(BrandPaths.WORDMARK_SPARK), fill = SolidColor(spark), pathFillType = PathFillType.EvenOdd)
            .build()
    }
    Image(
        rememberVectorPainter(v),
        contentDescription = null,
        modifier = modifier.height(height).width(height * 2.2945f).semantics { contentDescription = "Nexa" },
    )
}
