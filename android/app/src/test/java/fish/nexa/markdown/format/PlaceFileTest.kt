package fish.nexa.markdown.format

import fish.nexa.ui.format.Cmd
import fish.nexa.ui.format.FormatSurface
import fish.nexa.ui.markdown.format.FileBlock
import org.junit.Assert.assertEquals
import org.junit.Test

/** Moving a note's file and putting it on a side of its line (surface.test.ts, "moves a file between other lines"). */
class PlaceFileTest {
    private fun note(md: String) = FormatSurface(md, files = true, max = 100_000, focusOnOpen = false)

    private fun FormatSurface.fileId() = blocks.first { it is FileBlock }.id

    @Test
    fun keepsWidthAndSideThroughTheText() {
        for (line in listOf("![a.png](nexa-file:a?w=60&a=left)", "![a.png](nexa-file:a?w=40&a=right)", "![a.png](nexa-file:a?a=right)", "![a.png](nexa-file:a?w=60)")) {
            assertEquals("x\n$line\ny", note("x\n$line\ny").markdown())
        }
        val f = note("x\n![a.png](nexa-file:a?w=60&a=left)\ny").blocks[1] as FileBlock
        assertEquals(60, f.width)
        assertEquals("left", f.align)
        // a side it does not know, or the wrong order, is no file line at all
        assertEquals(false, note("![a.png](nexa-file:a?w=60&a=up)").blocks.any { it is FileBlock })
        assertEquals(false, note("![a.png](nexa-file:a?a=left&w=60)").blocks.any { it is FileBlock })
    }

    @Test
    fun movesBetweenLinesAndToASide() {
        val n = note("one\n![a.png](nexa-file:a?w=50)\n\ntwo\nthree")
        val id = n.fileId()
        n.command(Cmd.PlaceFile(id, 4, null))
        assertEquals("one\ntwo\n![a.png](nexa-file:a?w=50)\nthree", n.markdown())
        n.command(Cmd.PlaceFile(id, 0, "left"))
        assertEquals("![a.png](nexa-file:a?w=50&a=left)\none\ntwo\nthree", n.markdown())
        n.command(Cmd.PlaceFile(id, null, "right"))
        assertEquals("![a.png](nexa-file:a?w=50&a=right)\none\ntwo\nthree", n.markdown())
        n.command(Cmd.PlaceFile(id, 1, "right"))
        assertEquals("![a.png](nexa-file:a?w=50&a=right)\none\ntwo\nthree", n.markdown())
        n.command(Cmd.PlaceFile(id, 4, null))
        assertEquals("one\ntwo\nthree\n![a.png](nexa-file:a?w=50)", n.markdown())
        repeat(4) { n.command(Cmd.Undo) }
        assertEquals("one\n![a.png](nexa-file:a?w=50)\n\ntwo\nthree", n.markdown())
    }
}
