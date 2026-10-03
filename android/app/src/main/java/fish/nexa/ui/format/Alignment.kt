package fish.nexa.ui.format

/**
 * Lining up two lists of the same kind of thing (web/src/lib/align.ts): which
 * items of one are still there in the other, in order. The editor uses it on
 * paragraphs, to tell what of a note stayed as it was when someone else's
 * change arrives.
 */
object Alignment {
    /** Above this many cells the table of matches is not built, and the two stretches count as wholly different. */
    private const val MAX_CELLS = 4_000_000L

    /** For each item of `a`, the index of the item of `b` it matches in a longest common subsequence, or -1. */
    fun of(a: List<String>, b: List<String>): IntArray {
        val map = IntArray(a.size) { -1 }
        var start = 0
        while (start < a.size && start < b.size && a[start] == b[start]) {
            map[start] = start
            start++
        }
        var endA = a.size
        var endB = b.size
        while (endA > start && endB > start && a[endA - 1] == b[endB - 1]) {
            endA--
            endB--
            map[endA] = endB
        }
        val n = endA - start
        val m = endB - start
        if (n == 0 || m == 0 || n.toLong() * m > MAX_CELLS) return map
        // lengths of the longest common subsequence of the tails a[i:], b[j:]
        val width = m + 1
        val table = IntArray((n + 1) * width)
        for (i in n - 1 downTo 0) {
            for (j in m - 1 downTo 0) {
                table[i * width + j] = if (a[start + i] == b[start + j]) table[(i + 1) * width + j + 1] + 1 else maxOf(table[(i + 1) * width + j], table[i * width + j + 1])
            }
        }
        var i = 0
        var j = 0
        while (i < n && j < m) {
            if (a[start + i] == b[start + j]) {
                map[start + i] = start + j
                i++
                j++
            } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
            else j++
        }
        return map
    }
}
