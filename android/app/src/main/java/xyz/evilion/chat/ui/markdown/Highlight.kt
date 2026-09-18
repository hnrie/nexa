package xyz.evilion.chat.ui.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import xyz.evilion.chat.ui.theme.ChatColors

/**
 * Colours inside a fenced code block.
 *
 * The web client hands the block to highlight.js and paints its output with
 * eight palette roles (`--code-keyword` and friends, web/src/styles/markdown.css).
 * Shipping highlight.js' grammars to a phone is a megabyte of dictionaries for
 * a feature that is read at a glance, so this is the honest small version: one
 * tokeniser that knows comments, strings, numbers, a shared keyword set and the
 * shapes of a call and a type name. It paints the same eight roles, so a
 * snippet looks like the same snippet in both clients even where a real grammar
 * would have been more precise.
 *
 * Like the web, it only runs when the fence named a language it recognises;
 * an unlabelled or unknown block stays plain rather than being guessed at.
 */
internal fun highlight(text: String, lang: String?, colors: ChatColors): AnnotatedString {
    val rules = rulesFor(lang) ?: return AnnotatedString(text)
    return buildAnnotatedString {
        var i = 0
        val buffer = StringBuilder()

        fun flush() {
            if (buffer.isNotEmpty()) {
                append(buffer.toString())
                buffer.clear()
            }
        }

        fun paint(span: SpanStyle, from: Int, to: Int) {
            flush()
            pushStyle(span)
            append(text, from, to)
            pop()
            i = to
        }

        while (i < text.length) {
            val c = text[i]

            // comments ------------------------------------------------------
            val line = rules.lineComment.firstOrNull { text.startsWith(it, i) }
            if (line != null) {
                val end = text.indexOf('\n', i).takeIf { it >= 0 } ?: text.length
                paint(SpanStyle(color = colors.codeComment, fontStyle = FontStyle.Italic), i, end)
                continue
            }
            if (rules.blockComment && text.startsWith("/*", i)) {
                val close = text.indexOf("*/", i + 2)
                val end = if (close < 0) text.length else close + 2
                paint(SpanStyle(color = colors.codeComment, fontStyle = FontStyle.Italic), i, end)
                continue
            }

            // strings -------------------------------------------------------
            if (c in rules.quotes) {
                var j = i + 1
                while (j < text.length) {
                    if (text[j] == '\\') {
                        j += 2
                        continue
                    }
                    if (text[j] == c) {
                        j++
                        break
                    }
                    // a quote that never closes stops at the end of its line, so
                    // one stray apostrophe cannot tint the rest of the block
                    if (text[j] == '\n' && c != '`') break
                    j++
                }
                paint(SpanStyle(color = colors.codeString), i, minOf(j, text.length))
                continue
            }

            // numbers -------------------------------------------------------
            if (c.isDigit() && (i == 0 || !isWord(text[i - 1]))) {
                var j = i
                while (j < text.length && (text[j].isLetterOrDigit() || text[j] == '.' || text[j] == '_')) j++
                paint(SpanStyle(color = colors.codeNumber), i, j)
                continue
            }

            // words: keywords, literals, calls and type names ---------------
            if (isWord(c) && !c.isDigit()) {
                var j = i
                while (j < text.length && isWord(text[j])) j++
                val word = text.substring(i, j)
                var after = j
                while (after < text.length && text[after] == ' ') after++
                val span = when {
                    word in KEYWORDS -> SpanStyle(color = colors.codeKeyword)
                    word in LITERALS -> SpanStyle(color = colors.codeKeyword)
                    word in BUILT_INS -> SpanStyle(color = colors.codeType)
                    after < text.length && text[after] == '(' -> SpanStyle(color = colors.codeTitle)
                    word.first().isUpperCase() -> SpanStyle(color = colors.codeType)
                    else -> null
                }
                if (span == null) {
                    buffer.append(word)
                    i = j
                } else {
                    paint(span, i, j)
                }
                continue
            }

            buffer.append(c)
            i++
        }
        flush()
    }
}

private fun isWord(c: Char): Boolean = c.isLetterOrDigit() || c == '_' || c == '$'

/** How one family of languages writes its comments and strings. */
private class Rules(val lineComment: List<String>, val blockComment: Boolean, val quotes: String)

private val C_LIKE = Rules(listOf("//"), blockComment = true, quotes = "\"'`")
private val HASH = Rules(listOf("#"), blockComment = false, quotes = "\"'")
private val DASH = Rules(listOf("--"), blockComment = true, quotes = "\"'")
private val CSS = Rules(emptyList(), blockComment = true, quotes = "\"'")

private fun rulesFor(lang: String?): Rules? = when (lang?.lowercase()) {
    "js", "jsx", "javascript", "mjs", "cjs", "ts", "tsx", "typescript",
    "java", "kotlin", "kt", "kts", "c", "h", "cpp", "cc", "cxx", "hpp",
    "cs", "csharp", "go", "golang", "rust", "rs", "swift", "php", "scala",
    "dart", "groovy", "objc", "proto", "zig", "v",
    -> C_LIKE
    "python", "py", "sh", "bash", "zsh", "shell", "console", "ruby", "rb",
    "yaml", "yml", "toml", "ini", "perl", "r", "make", "makefile", "dockerfile",
    "elixir", "ex", "nix", "tcl", "awk", "gitignore",
    -> HASH
    "sql", "lua", "haskell", "hs", "ada", "elm", "postgres", "psql" -> DASH
    "css", "scss", "less" -> CSS
    else -> null
}

/**
 * One keyword set across the languages above.
 *
 * A single set colours a `for` in Go and a `for` in Python alike, and misses
 * nothing that any of them calls a keyword. The cost is that a word that is a
 * keyword somewhere else is coloured here too — `func` inside a Python string
 * is already handled, and a bare `impl` in JavaScript is not something anyone
 * will notice.
 */
private val KEYWORDS = setOf(
    "abstract", "and", "as", "assert", "async", "await", "break", "case", "catch", "class",
    "const", "constexpr", "continue", "crate", "data", "def", "default", "defer", "del",
    "delete", "do", "elif", "else", "elseif", "end", "enum", "except", "export", "extends",
    "extern", "final", "finally", "fn", "for", "from", "func", "function", "go", "goto",
    "if", "impl", "implements", "import", "in", "inline", "instanceof", "interface", "internal",
    "is", "lambda", "let", "loop", "match", "mod", "module", "mut", "namespace", "new", "not",
    "object", "open", "operator", "or", "override", "package", "pass", "print", "private",
    "protected", "pub", "public", "raise", "range", "readonly", "record", "ref", "register",
    "require", "return", "sealed", "select", "self", "static", "struct", "super", "suspend",
    "switch", "template", "then", "this", "throw", "throws", "trait", "try", "type", "typedef",
    "typeof", "union", "unless", "unsafe", "until", "use", "using", "val", "var", "virtual",
    "void", "when", "where", "while", "with", "yield",
    // SQL reads as shouting, so both cases are here
    "select", "insert", "update", "delete", "where", "join", "group", "order", "limit",
    "SELECT", "INSERT", "UPDATE", "DELETE", "FROM", "WHERE", "JOIN", "GROUP", "ORDER", "LIMIT",
    "CREATE", "TABLE", "INDEX", "ALTER", "DROP", "VALUES", "SET", "AND", "OR", "NOT", "NULL",
)

private val LITERALS = setOf(
    "true", "false", "null", "nil", "None", "True", "False", "undefined", "NaN", "Infinity",
)

private val BUILT_INS = setOf(
    "int", "long", "float", "double", "bool", "boolean", "char", "byte", "short", "string",
    "str", "list", "dict", "set", "tuple", "map", "array", "vec", "usize", "isize",
    "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "any", "unknown",
    "number", "symbol", "bigint", "error", "err", "self",
)
