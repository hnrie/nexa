package fish.nexa.ui.markdown

/**
 * What a message's markdown parses to (web/src/markdown/ast.ts). Block nodes
 * (paragraph, quote, heading, subtext, list, codeblock, hr, table, alert,
 * details, footnotes, file) appear only at the top level of a parse that is
 * not inline, or inside an alert or a details section; everything else is
 * inline and may nest.
 *
 * Each type says what the renderer draws for it, from web/src/markdown/render.tsx
 * and web/src/styles/markdown.css (em is the font size of the text around it).
 * Every block takes the direction of its own words (`dir="auto"`).
 */
sealed class Node {
    /** The web's name for the type ("text", "strong", "list", ...). */
    abstract val type: String

    /** A node of inline children, copied with others by [withChildren]. */
    sealed class Container(val children: List<Node>) : Node() {
        abstract fun withChildren(children: List<Node>): Container
    }

    /** Words as they are, `white-space: pre-wrap`, breaking anywhere when a word is too long; drawn through [Zalgo.clamp]. */
    class Text(val text: String) : Node() {
        override val type get() = "text"
    }

    /** A line break inside a block. */
    object Br : Node() {
        override val type get() = "br"
    }

    /** Bold (700). */
    class Strong(children: List<Node>) : Container(children) {
        override val type get() = "strong"
        override fun withChildren(children: List<Node>) = Strong(children)
    }

    /** Italic. */
    class Em(children: List<Node>) : Container(children) {
        override val type get() = "em"
        override fun withChildren(children: List<Node>) = Em(children)
    }

    /** Underlined. */
    class U(children: List<Node>) : Container(children) {
        override val type get() = "u"
        override fun withChildren(children: List<Node>) = U(children)
    }

    /** Struck through. */
    class S(children: List<Node>) : Container(children) {
        override val type get() = "s"
        override fun withChildren(children: List<Node>) = S(children)
    }

    /**
     * Hidden words: `--spoiler` fill, radius 4, padding 0 2px, the words invisible
     * (and out of TalkBack: the hidden run is one button labelled
     * `render.spoilerHidden`). A tap only uncovers it (a link or mention inside
     * waits for a second tap); uncovered it is `--spoiler-revealed` with the words
     * in their own colour. A preview (inert) keeps it covered and offers nothing.
     */
    class Spoiler(children: List<Node>) : Container(children) {
        override val type get() = "spoiler"
        override fun withChildren(children: List<Node>) = Spoiler(children)
    }

    /** A block of inline text, `white-space: pre-wrap`, breaking anywhere. */
    class Paragraph(children: List<Node>) : Container(children) {
        override val type get() = "paragraph"
        override fun withChildren(children: List<Node>) = Paragraph(children)
    }

    /**
     * A block quote: margin 2 0, padding-inline 12 (start) 8 (end), a 3 px start
     * border of `--brand` mixed 55% with `--border-strong`, radius 2, `--text` colour.
     */
    class Quote(children: List<Node>) : Container(children) {
        override val type get() = "quote"
        override fun withChildren(children: List<Node>) = Quote(children)
    }

    /** Highlighted: `--warning` at 32% behind the words, radius 3, padding 0 2px, the text colour unchanged. */
    class Mark(children: List<Node>) : Container(children) {
        override val type get() = "mark"
        override fun withChildren(children: List<Node>) = Mark(children)
    }

    /** Raised: 0.75em, lifted 0.5em, without pushing the lines apart. */
    class Sup(children: List<Node>) : Container(children) {
        override val type get() = "sup"
        override fun withChildren(children: List<Node>) = Sup(children)
    }

    /** Lowered: 0.75em, dropped 0.25em, without pushing the lines apart. */
    class Sub(children: List<Node>) : Container(children) {
        override val type get() = "sub"
        override fun withChildren(children: List<Node>) = Sub(children)
    }

    /**
     * Inline code, always left to right: JetBrains Mono at 0.875em, padding
     * 0.2em 0.38em, radius 5, `--code-bg` with a 1 px `--code-border`, wrapping.
     */
    class Code(val text: String) : Node() {
        override val type get() = "code"
    }

    /**
     * A block of code, left to right: margin-top 6, padding 10 12, radius 10
     * (`--radius-sm`), `--code-bg`, 1 px `--code-border`, an inner shadow
     * (0 1px 3px shade at 35%), mono 0.875em, line height 1.45, no wrapping (it
     * scrolls sideways inside itself). `lang` is a highlight.js language name,
     * coloured with `--code-keyword/string/number/comment/title/type/variable`
     * (comments italic); null or unknown is plain. A Copy button (Copy 15,
     * 36 x 36 on touch, 2 px from the top-end corner, `--bg-floating`, 1 px
     * `--code-border`, `--shadow-low`, `--text-muted`, opacity 0.9) copies just
     * `text` (label `render.copyCode`, toast `clipboard.codeCopied`).
     */
    class CodeBlock(val lang: String?, val text: String) : Node() {
        override val type get() = "codeblock"
    }

    /**
     * A heading, line height 1.25: h1 1.5em/700 and h2 1.25em/700 (margin 16 0 8),
     * h3 1em/700 (16 0 4), h4 0.9375em/700, h5 0.875em/700, h6 0.875em/600 in
     * `--text-muted` (12 0 4); the first block of a message keeps only 4 on top.
     */
    class Heading(val level: Int, children: List<Node>) : Container(children) {
        override val type get() = "heading"
        override fun withChildren(children: List<Node>) = Heading(level, children)
    }

    /** Small print on a line of its own: 0.8125em, `--text-muted`. */
    class Subtext(children: List<Node>) : Container(children) {
        override val type get() = "subtext"
        override fun withChildren(children: List<Node>) = Subtext(children)
    }

    /**
     * A list, numbered from `start` when `ordered`, else bulleted: margin 4 0,
     * padding-inline-start 24, items 2 apart. An item may hold a nested
     * [ListBlock] after its words. An item that starts with a [Task] shows no
     * bullet; its box stands where the bullet would.
     */
    class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<Node>>) : Node() {
        override val type get() = "list"
    }

    /**
     * A checklist box, read only, always the first node of its item: 15 x 15,
     * radius 4, 1.5 px `--text-muted` border; ticked, `--brand` fill and border
     * with an `--on-brand` tick. Sits 21 before the item's words, 6 from them.
     * TalkBack: `render.taskDone` / `render.taskOpen`.
     */
    class Task(val checked: Boolean) : Node() {
        override val type get() = "task"
    }

    /** A rule: 1 px `--border-strong`, margin 10 0. */
    object Hr : Node() {
        override val type get() = "hr"
    }

    /**
     * A file a note holds, on a line of its own (only when parsed with
     * `files`): drawn by the note's own file view, `width` percent of the line
     * for a picture when not all of it; without one, `name` as a paragraph.
     */
    class File(val id: String, val name: String, val width: Int?) : Node() {
        override val type get() = "file"
    }

    /**
     * A table, as wide as it needs up to the column and scrolling sideways in
     * its own box (1 px `--border`, radius 10, margin 6 0; TalkBack
     * `render.table` while it scrolls): 0.9375em, line height 1.4, cells padding
     * 6 12, top aligned, wrapping at spaces only; header cells 600 on `--text`
     * at 6%; 1 px `--border` between columns and above each body row; even body
     * rows on `--text` at 3%. Each column lines up as `align` says (null: start).
     * Every row has exactly `align.size` cells.
     */
    class Table(val align: List<Align?>, val head: List<List<Node>>, val rows: List<List<List<Node>>>) : Node() {
        override val type get() = "table"
    }

    /**
     * A callout: margin 6 0, padding 8 12, a 4 px start border in its accent,
     * radius 4, the accent at 7% behind it; a title row (icon 16, 6 apart, 600,
     * line height 1.375, the accent mixed 80% with `--text-strong`) with
     * [Markdown.alertTitle], then its blocks. Accent and icon: note `--link`
     * Info, tip `--positive` Lightbulb, important `--text-brand`
     * MessageSquareWarning, warning `--text-warning` TriangleAlert, caution
     * `--text-danger` OctagonAlert.
     */
    class Alert(val kind: AlertKind, children: List<Node>) : Container(children) {
        override val type get() = "alert"
        override fun withChildren(children: List<Node>) = Alert(kind, children)
    }

    /**
     * A collapsible section, closed at first: margin 6 0, 1 px `--border`, radius
     * 10, `--text` at 3%. The summary row is the button (min height 44 on touch,
     * padding 4 10, 600, a ChevronRight 16 in `--text-muted` that turns 90
     * degrees open, 180 in right-to-left); an empty summary reads
     * `render.details`. Open, its blocks follow with padding 2 10 8, 32 at the start.
     */
    class Details(val summary: List<Node>, val children: List<Node>) : Node() {
        override val type get() = "details"
    }

    /**
     * Words in their author's colour: paint with [MarkdownColors.paint] against
     * what they sit on (text colour, and a fill with radius 3 and padding 0 2px
     * when `bg` is set). `fg`/`bg` are a palette name or "#rrggbb". A link
     * inside takes the colour and keeps an underline.
     */
    class Color(val fg: String?, val bg: String?, children: List<Node>) : Container(children) {
        override val type get() = "color"
        override fun withChildren(children: List<Node>) = Color(fg, bg, children)
    }

    /**
     * A footnote's number in the text: 0.75em, raised, `--link` 600 with a
     * finger-sized touch area; a tap scrolls to the note. TalkBack
     * `render.footnote` {n}.
     */
    class FootnoteRef(val label: String, val n: Int) : Node() {
        override val type get() = "footnoteRef"
    }

    /**
     * The notes, at the end of the message under a 1 px `--border` (margin-top
     * 8, padding-top 6), 0.8125em, line height 1.45, `--text-muted`: a list
     * numbered by each note's `n` (indent 20), each with a way back to its
     * reference (CornerUpLeft 13 in `--link`, mirrored in right-to-left,
     * TalkBack `render.footnoteBack` {n}).
     */
    class Footnotes(val notes: List<Footnote>) : Node() {
        override val type get() = "footnotes"
    }

    /**
     * A link in `--link` (underlined when the account underlines links). A
     * masked one names its real site after its words ([Markdown.maskedHost]:
     * 0.8em, 500, `--bg-active`, `--text-muted`, radius 3, padding 0 0.3em,
     * left to right). An invite link to this server, unmasked, reads as
     * [AppLinks.shownInvite] instead of its words. `noEmbed`: written as <url>,
     * so no preview. In a preview (inert) it is only coloured words.
     */
    class Link(val url: String, children: List<Node>, val masked: Boolean, val noEmbed: Boolean) : Container(children) {
        override val type get() = "link"
        override fun withChildren(children: List<Node>) = Link(url, children, masked, noEmbed)
    }

    /**
     * A mention: padding 0 3px, radius 5, `--mention-bg`, `--mention-fg`, 600.
     * User: "@" + display name, else username, else `render.unknownUser`; a tap
     * opens their profile. Channel: its glyph and name, a tap opens it; unknown,
     * "#" + `render.unknownChannel` in `--text-muted` on muted 14%, inert.
     * Role: "@" + name, inert; a coloured role is its colour mixed 72% with
     * `--text-strong` on its colour at 16%; unknown "@" + `render.unknownRole`
     * muted. Everyone and here: `render.everyone` / `render.here`, inert.
     */
    class Mention(val kind: MentionKind, val id: String?) : Node() {
        override val type get() = "mention"
    }

    /**
     * A custom emoji's picture (`name` is its alt text ":name:"), in a box
     * 1.375em square (margin 0 0.05em, bottom aligned); jumbo 48 square with
     * 2.4 margins, centred. `id` is the picture's blob id.
     */
    class Emoji(val name: String, val id: String, val animated: Boolean) : Node() {
        override val type get() = "emoji"
    }

    /** A Unicode emoji, drawn as its Twemoji picture in the same boxes as [Emoji]. */
    class UnicodeEmoji(val text: String) : Node() {
        override val type get() = "unicodeEmoji"
    }

    /**
     * A `<t:unix:style>` time in the reader's language ([Timestamps.stamp]),
     * set apart: padding 0 4, radius 5, `--bg-active`. Style R keeps counting
     * ([Timestamps.relativeTick]); its full form (style F) is its long-press
     * title. A time no date can hold reads as [Js.numberToString] of `unix`.
     */
    class Timestamp(val unix: Double, val style: Char) : Node() {
        override val type get() = "timestamp"
    }
}

/** One note of [Node.Footnotes]: its label as written, its number, and what it says. */
class Footnote(val label: String, val n: Int, val children: List<Node>)

/** The five callouts: `> [!NOTE]` and so on. */
enum class AlertKind(val key: String) {
    NOTE("note"), TIP("tip"), IMPORTANT("important"), WARNING("warning"), CAUTION("caution");

    /** Its title's catalogue key. */
    val titleKey: String get() = "render.alert.$key"
}

/** How a table column lines up, as its delimiter row says (`:--`, `:-:`, `--:`); null is the start. */
enum class Align(val key: String) { LEFT("left"), CENTER("center"), RIGHT("right") }

/** What a [Node.Mention] points at; [Node.Mention.id] is null for everyone and here. */
enum class MentionKind(val key: String) { USER("user"), CHANNEL("channel"), ROLE("role"), EVERYONE("everyone"), HERE("here") }
