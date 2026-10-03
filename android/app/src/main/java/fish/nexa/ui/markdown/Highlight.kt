package fish.nexa.ui.markdown

/**
 * Colours for code blocks, in the spirit of highlight.js as the web uses it:
 * comments, strings, numbers, keywords, the names of functions being called
 * or declared, and type names, each in its --code-* colour. One tokenizer
 * serves the common languages, with each language's own keywords and comment
 * marks; an unknown language is left plain, as the web leaves it.
 */
object Highlight {
    enum class Kind { KEYWORD, STRING, NUMBER, COMMENT, TITLE, TYPE, VARIABLE }

    data class Span(val start: Int, val end: Int, val kind: Kind)

    private data class Lang(val keywords: Set<String>, val line: List<String>, val block: Pair<String, String>?, val types: Set<String> = emptySet(), val dollarVars: Boolean = false)

    private fun words(s: String) = s.split(' ', '\n').filter { it.isNotEmpty() }.toSet()

    private val C_LIKE = words(
        "if else for while do switch case default break continue return goto try catch finally throw throws new delete " +
            "class struct enum union interface extends implements public private protected static final const void " +
            "import package export from as using namespace typedef sizeof typeof instanceof in of this super null true false",
    )
    private val JS = C_LIKE + words("var let function async await yield get set undefined NaN Infinity debugger with constructor declare type keyof readonly abstract any unknown never")
    private val PY = words("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self print")
    private val RUST = words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while")
    private val GO = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota")
    private val KOTLIN = C_LIKE + words("fun val var when object companion data sealed open override internal lateinit by is it init suspend inline reified vararg")
    private val SHELL = words("if then else elif fi for while until do done case esac in function return export local echo exit set unset source alias cd sudo")
    private val SQL = words("select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset as and or not null is in like between distinct union all primary key foreign references index view default")
    private val CSS = words("important media import keyframes from to inherit initial unset auto none")
    private val JAVA_TYPES = words("int long short byte char float double boolean bool string String Int Long Float Double Boolean Unit Any void u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 usize isize str")

    private val LANGS: Map<String, Lang> = buildMap {
        val js = Lang(JS, listOf("//"), "/*" to "*/", JAVA_TYPES)
        for (n in listOf("js", "javascript", "jsx", "ts", "typescript", "tsx", "mjs", "cjs", "json", "jsonc")) put(n, js)
        val c = Lang(C_LIKE + words("auto register volatile extern signed unsigned inline template typename virtual operator friend mutable constexpr nullptr bool"), listOf("//"), "/*" to "*/", JAVA_TYPES)
        for (n in listOf("c", "h", "cpp", "c++", "cc", "hpp", "cs", "csharp", "java", "swift", "dart", "php", "scala", "objc")) put(n, c)
        put("kotlin", Lang(KOTLIN, listOf("//"), "/*" to "*/", JAVA_TYPES)); put("kt", get("kotlin")!!)
        val py = Lang(PY, listOf("#"), null, JAVA_TYPES)
        for (n in listOf("py", "python", "py3")) put(n, py)
        val rb = Lang(words("def end if elsif else unless while until for in do return class module self nil true false yield begin rescue ensure require"), listOf("#"), null)
        for (n in listOf("rb", "ruby")) put(n, rb)
        val rs = Lang(RUST, listOf("//"), "/*" to "*/", JAVA_TYPES)
        for (n in listOf("rs", "rust")) put(n, rs)
        val go = Lang(GO, listOf("//"), "/*" to "*/", JAVA_TYPES)
        for (n in listOf("go", "golang")) put(n, go)
        val sh = Lang(SHELL, listOf("#"), null, dollarVars = true)
        for (n in listOf("sh", "bash", "shell", "zsh", "console", "powershell", "ps1")) put(n, sh)
        val sql = Lang(SQL + SQL.map { it.uppercase() }, listOf("--"), "/*" to "*/")
        put("sql", sql)
        val css = Lang(CSS, emptyList(), "/*" to "*/")
        for (n in listOf("css", "scss", "less")) put(n, css)
        val lua = Lang(words("and break do else elseif end false for function goto if in local nil not or repeat return then true until while"), listOf("--"), "--[[" to "]]")
        put("lua", lua)
        val yaml = Lang(words("true false null yes no on off"), listOf("#"), null)
        for (n in listOf("yaml", "yml", "toml", "ini")) put(n, yaml)
        val html = Lang(emptySet(), emptyList(), "<!--" to "-->")
        for (n in listOf("html", "xml", "svg", "vue")) put(n, html)
    }

    fun known(lang: String?): Boolean = lang != null && LANGS.containsKey(lang.lowercase())

    fun spans(code: String, lang: String?): List<Span> {
        val l = lang?.lowercase()?.let { LANGS[it] } ?: return emptyList()
        val out = ArrayList<Span>()
        var i = 0
        val n = code.length
        fun startsAt(s: String) = code.startsWith(s, i)
        while (i < n) {
            val c = code[i]
            // comments
            val blk = l.block
            if (blk != null && startsAt(blk.first)) {
                val end = code.indexOf(blk.second, i + blk.first.length).let { if (it < 0) n else it + blk.second.length }
                out += Span(i, end, Kind.COMMENT); i = end; continue
            }
            if (l.line.any { startsAt(it) }) {
                val end = code.indexOf('\n', i).let { if (it < 0) n else it }
                out += Span(i, end, Kind.COMMENT); i = end; continue
            }
            // strings
            if (c == '"' || c == '\'' || c == '`') {
                var j = i + 1
                while (j < n && code[j] != c) {
                    if (code[j] == '\\') j++
                    if (c != '`' && j < n && code[j] == '\n') break
                    j++
                }
                val end = minOf(n, j + 1)
                out += Span(i, end, Kind.STRING); i = end; continue
            }
            // numbers
            if (c.isDigit() && (i == 0 || !code[i - 1].isLetterOrDigit() && code[i - 1] != '_')) {
                var j = i + 1
                while (j < n && (code[j].isLetterOrDigit() || code[j] == '.' || code[j] == '_')) j++
                out += Span(i, j, Kind.NUMBER); i = j; continue
            }
            // shell variables
            if (l.dollarVars && c == '$' && i + 1 < n && (code[i + 1].isLetter() || code[i + 1] == '{' || code[i + 1] == '_')) {
                var j = i + 1
                if (code[j] == '{') j = code.indexOf('}', j).let { if (it < 0) n else it + 1 }
                else while (j < n && (code[j].isLetterOrDigit() || code[j] == '_')) j++
                out += Span(i, j, Kind.VARIABLE); i = j; continue
            }
            // words: keywords, types, called or declared names
            if (c.isLetter() || c == '_' || c == '@') {
                var j = i + 1
                while (j < n && (code[j].isLetterOrDigit() || code[j] == '_')) j++
                val word = code.substring(i, j)
                var k = j
                while (k < n && code[k] == ' ') k++
                val kind = when {
                    word in l.keywords -> Kind.KEYWORD
                    word in l.types -> Kind.TYPE
                    k < n && code[k] == '(' -> Kind.TITLE
                    word[0].isUpperCase() && word.length > 1 && word.any { it.isLowerCase() } -> Kind.TYPE
                    else -> null
                }
                if (kind != null) out += Span(i, j, kind)
                i = j
                continue
            }
            i++
        }
        return out
    }
}
