import { describe, expect, it } from "vitest";
import type { AlertKind, Align, Node } from "./ast";
import { extractUrls, isEmojiOnly, parse, plainText } from "./parse";

// ---------------------------------------------------------------------------
// tiny builders so the fixture table stays readable
// ---------------------------------------------------------------------------
const t = (text: string): Node => ({ type: "text", text });
const br: Node = { type: "br" };
const para = (...children: Node[]): Node => ({ type: "paragraph", children });
const quote = (...children: Node[]): Node => ({ type: "quote", children });
const strong = (...children: Node[]): Node => ({ type: "strong", children });
const em = (...children: Node[]): Node => ({ type: "em", children });
const u = (...children: Node[]): Node => ({ type: "u", children });
const s = (...children: Node[]): Node => ({ type: "s", children });
const spoiler = (...children: Node[]): Node => ({ type: "spoiler", children });
const code = (text: string): Node => ({ type: "code", text });
const codeblock = (lang: string | null, text: string): Node => ({ type: "codeblock", lang, text });
const heading = (level: 1 | 2 | 3, ...children: Node[]): Node => ({ type: "heading", level, children });
const subtext = (...children: Node[]): Node => ({ type: "subtext", children });
const list = (ordered: boolean, start: number, items: Node[][]): Node => ({ type: "list", ordered, start, items });
const link = (url: string, children: Node[] = [t(url)], masked = false, noEmbed = false): Node => ({
  type: "link",
  url,
  children,
  masked,
  noEmbed,
});
const user = (id: string): Node => ({ type: "mention", kind: "user", id });
const channel = (id: string): Node => ({ type: "mention", kind: "channel", id });
const role = (id: string): Node => ({ type: "mention", kind: "role", id });
const everyone: Node = { type: "mention", kind: "everyone" };
const here: Node = { type: "mention", kind: "here" };
const emoji = (name: string, id: string, animated = false): Node => ({ type: "emoji", name, id, animated });
const uni = (text: string): Node => ({ type: "unicodeEmoji", text });
const ts = (unix: number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R"): Node => ({ type: "timestamp", unix, style });
const mark = (...children: Node[]): Node => ({ type: "mark", children });
const sup = (...children: Node[]): Node => ({ type: "sup", children });
const sub = (...children: Node[]): Node => ({ type: "sub", children });
const color = (fg: string | null, bg: string | null, ...children: Node[]): Node => ({ type: "color", fg, bg, children });
const hr: Node = { type: "hr" };
const task = (checked: boolean): Node => ({ type: "task", checked });
const table = (align: Align[], head: Node[][], rows: Node[][][]): Node => ({ type: "table", align, head, rows });
const alert = (kind: AlertKind, ...children: Node[]): Node => ({ type: "alert", kind, children });
const details = (summary: Node[], ...children: Node[]): Node => ({ type: "details", summary, children });
const fnref = (label: string, n: number): Node => ({ type: "footnoteRef", label, n });
const footnotes = (...notes: [string, number, Node[]][]): Node => ({ type: "footnotes", notes: notes.map(([label, n, children]) => ({ label, n, children })) });
const h = (level: 1 | 2 | 3 | 4 | 5 | 6, ...children: Node[]): Node => ({ type: "heading", level, children });

interface Fixture {
  name: string;
  src: string;
  ast: Node[];
  inline?: boolean;
}

const fixtures: Fixture[] = [
  // --- basics -------------------------------------------------------------
  { name: "empty string", src: "", ast: [] },
  { name: "whitespace only", src: "\n\n  \n", ast: [] },
  { name: "plain text", src: "plain text", ast: [para(t("plain text"))] },
  { name: "leading newlines are dropped", src: "\n\nhi", ast: [para(t("hi"))] },
  { name: "trailing whitespace is dropped", src: "hi\n\n", ast: [para(t("hi"))] },

  // --- inline emphasis ----------------------------------------------------
  { name: "strong", src: "**bold**", ast: [para(strong(t("bold")))] },
  { name: "em with asterisk", src: "*italic*", ast: [para(em(t("italic")))] },
  { name: "em with underscore", src: "_italic_", ast: [para(em(t("italic")))] },
  { name: "underline", src: "__underline__", ast: [para(u(t("underline")))] },
  { name: "strikethrough", src: "~~strike~~", ast: [para(s(t("strike")))] },
  { name: "spoiler", src: "||spoiler||", ast: [para(spoiler(t("spoiler")))] },
  { name: "bold italic", src: "***bold italic***", ast: [para(strong(em(t("bold italic"))))] },
  { name: "underline italic", src: "___both___", ast: [para(u(em(t("both"))))] },
  { name: "nested strong in underline", src: "__**both**__", ast: [para(u(strong(t("both"))))] },
  { name: "nested em inside strong", src: "**bold _nested_ text**", ast: [para(strong(t("bold "), em(t("nested")), t(" text")))] },
  { name: "strong surrounded by text", src: "a **b** c", ast: [para(t("a "), strong(t("b")), t(" c"))] },
  { name: "spoiler with formatting", src: "||spoil **b**||", ast: [para(spoiler(t("spoil "), strong(t("b"))))] },
  { name: "strike followed by text", src: "~~a~~b", ast: [para(s(t("a")), t("b"))] },
  { name: "asterisk emphasis works mid word", src: "a*b*c", ast: [para(t("a"), em(t("b")), t("c"))] },
  { name: "underscore emphasis does not work mid word", src: "a_b_c", ast: [para(t("a_b_c"))] },
  { name: "snake_case_word is literal", src: "snake_case_word", ast: [para(t("snake_case_word"))] },
  { name: "_a_b_ closes at the word boundary", src: "_a_b_", ast: [para(em(t("a_b")))] },
  { name: "unmatched ** is literal", src: "**a", ast: [para(t("**a"))] },
  { name: "unmatched * is literal", src: "*a", ast: [para(t("*a"))] },
  { name: "lone ** is literal", src: "**", ast: [para(t("**"))] },
  { name: "closer preceded by space is not a closer", src: "*a *", ast: [para(t("*a *"))] },
  { name: "opener followed by space is not an opener", src: "x * a*", ast: [para(t("x * a*"))] },
  { name: "unmatched spoiler pipes are literal", src: "||nope", ast: [para(t("||nope"))] },
  { name: "unmatched tildes are literal", src: "~~nope", ast: [para(t("~~nope"))] },

  // --- escapes ------------------------------------------------------------
  { name: "escaped asterisks", src: "\\*not bold\\*", ast: [para(t("*not bold*"))] },
  { name: "escaped underscores", src: "\\_x\\_", ast: [para(t("_x_"))] },
  { name: "escaped backticks", src: "\\`code\\`", ast: [para(t("`code`"))] },
  { name: "backslash before a letter is literal", src: "\\a", ast: [para(t("\\a"))] },
  { name: "escaped backslash", src: "\\\\", ast: [para(t("\\"))] },

  // --- inline code --------------------------------------------------------
  { name: "inline code", src: "`code`", ast: [para(code("code"))] },
  { name: "inline code does not parse markers", src: "`*not bold*`", ast: [para(code("*not bold*"))] },
  { name: "double backtick code containing a backtick", src: "``a`b``", ast: [para(code("a`b"))] },
  { name: "two inline code spans", src: "`a` and `b`", ast: [para(code("a"), t(" and "), code("b"))] },
  { name: "unclosed backtick is literal", src: "`unclosed", ast: [para(t("`unclosed"))] },

  // --- line breaks --------------------------------------------------------
  { name: "newline becomes br inside one paragraph", src: "a\nb", ast: [para(t("a"), br, t("b"))] },
  { name: "blank line keeps both breaks", src: "a\n\nb", ast: [para(t("a"), br, br, t("b"))] },
  { name: "markers cannot span a line break", src: "**a\nb**", ast: [para(t("**a"), br, t("b**"))] },
  { name: "mixed line breaks with formatting", src: "**a**\n*b*", ast: [para(strong(t("a")), br, em(t("b")))] },

  // --- headings -----------------------------------------------------------
  { name: "h1", src: "# Heading", ast: [heading(1, t("Heading"))] },
  { name: "h2", src: "## Heading", ast: [heading(2, t("Heading"))] },
  { name: "h3", src: "### Heading", ast: [heading(3, t("Heading"))] },
  { name: "h4", src: "#### four", ast: [h(4, t("four"))] },
  { name: "h5", src: "##### five", ast: [h(5, t("five"))] },
  { name: "h6", src: "###### six", ast: [h(6, t("six"))] },
  { name: "seven hashes is text", src: "####### seven", ast: [para(t("####### seven"))] },
  { name: "closing hashes are dropped", src: "## Title ##", ast: [h(2, t("Title"))] },
  { name: "a hash ending a word stays", src: "# C#", ast: [h(1, t("C#"))] },
  { name: "an escaped closing hash stays", src: "# a \\#", ast: [h(1, t("a #"))] },
  { name: "hash without a space is text", src: "#nospace", ast: [para(t("#nospace"))] },
  { name: "heading content is parsed inline", src: "# **bold** head", ast: [heading(1, strong(t("bold")), t(" head"))] },
  { name: "heading then paragraph", src: "# a\nb", ast: [heading(1, t("a")), para(t("b"))] },
  { name: "heading only at line start", src: "a # b", ast: [para(t("a # b"))] },

  // --- subtext ------------------------------------------------------------
  { name: "subtext", src: "-# small print", ast: [subtext(t("small print"))] },
  { name: "subtext without a space is text", src: "-#nospace", ast: [para(t("-#nospace"))] },
  { name: "subtext is parsed inline", src: "-# a *b*", ast: [subtext(t("a "), em(t("b")))] },

  // --- quotes -------------------------------------------------------------
  { name: "quote", src: "> quoted", ast: [quote(t("quoted"))] },
  { name: "consecutive quote lines merge", src: "> a\n> b", ast: [quote(t("a"), br, t("b"))] },
  { name: "bare > line inside a quote", src: ">\n> x", ast: [quote(br, t("x"))] },
  { name: "quote without a space is text", src: ">no space", ast: [para(t(">no space"))] },
  { name: "quote content is parsed inline", src: "> **b**", ast: [quote(strong(t("b")))] },
  { name: "paragraph then quote", src: "a\n> q", ast: [para(t("a")), quote(t("q"))] },
  { name: "block quote consumes the rest", src: ">>> all\nthe rest", ast: [quote(t("all"), br, t("the rest"))] },
  { name: "block quote swallows block syntax", src: ">>> a\n# b", ast: [quote(t("a"), br, t("# b"))] },

  // --- code blocks --------------------------------------------------------
  { name: "fenced code block", src: "```\ncode\n```", ast: [codeblock(null, "code")] },
  { name: "fenced code block with language", src: "```js\nconst a = 1;\n```", ast: [codeblock("js", "const a = 1;")] },
  { name: "fence language may contain + and -", src: "```c++\nx\n```", ast: [codeblock("c++", "x")] },
  { name: "unclosed fence runs to the end", src: "```js\nunclosed", ast: [codeblock("js", "unclosed")] },
  { name: "fence content is raw", src: "```\n**not bold** \\*\n```", ast: [codeblock(null, "**not bold** \\*")] },
  { name: "fence between paragraphs", src: "text\n```\nx\n```\nafter", ast: [para(t("text")), codeblock(null, "x"), para(t("after"))] },
  { name: "fence with trailing spaces on the opening line", src: "``` \nx\n```", ast: [codeblock(null, "x")] },
  { name: "single line fence", src: "```x```", ast: [codeblock(null, "x")] },
  { name: "multi line fence content", src: "```\na\n\nb\n```", ast: [codeblock(null, "a\n\nb")] },
  { name: "a longer fence holds three backticks", src: "````md\n```js\nx\n```\n````", ast: [codeblock("md", "```js\nx\n```")] },
  { name: "a longer fence on one line", src: "````a```b````", ast: [codeblock(null, "a```b")] },

  // --- lists --------------------------------------------------------------
  { name: "dash list", src: "- one\n- two", ast: [list(false, 1, [[t("one")], [t("two")]])] },
  { name: "star list", src: "* one\n* two", ast: [list(false, 1, [[t("one")], [t("two")]])] },
  { name: "ordered list", src: "1. one\n2. two", ast: [list(true, 1, [[t("one")], [t("two")]])] },
  { name: "ordered list keeps its start", src: "3. a\n4. b", ast: [list(true, 3, [[t("a")], [t("b")]])] },
  { name: "nested list", src: "- a\n  - b", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b")]])]])] },
  { name: "nested ordered list inside a bullet", src: "- a\n  1. b\n- c", ast: [list(false, 1, [[t("a"), list(true, 1, [[t("b")]])], [t("c")]])] },
  { name: "list item content is parsed inline", src: "- **bold** item", ast: [list(false, 1, [[strong(t("bold")), t(" item")]])] },
  { name: "list then paragraph", src: "- a\ntext", ast: [list(false, 1, [[t("a")]]), para(t("text"))] },
  { name: "switching marker kind starts a new list", src: "1. a\n- b", ast: [list(true, 1, [[t("a")]]), list(false, 1, [[t("b")]])] },
  { name: "dash without a space is text", src: "-no space", ast: [para(t("-no space"))] },
  { name: "list item holding a lone asterisk", src: "* *", ast: [list(false, 1, [[t("*")]])] },

  // --- links --------------------------------------------------------------
  { name: "bare url is autolinked", src: "https://example.com", ast: [para(link("https://example.com"))] },
  { name: "http is autolinked too", src: "http://a.b", ast: [para(link("http://a.b"))] },
  { name: "trailing period is not part of the url", src: "see https://a.b/c.", ast: [para(t("see "), link("https://a.b/c"), t("."))] },
  { name: "unbalanced closing paren is trimmed", src: "(https://a.b/c)", ast: [para(t("("), link("https://a.b/c"), t(")"))] },
  { name: "balanced parens stay in the url", src: "https://a.b/wiki/Foo_(bar)", ast: [para(link("https://a.b/wiki/Foo_(bar)"))] },
  { name: "unbalanced closing bracket is trimmed", src: "[https://a.b/c]", ast: [para(t("["), link("https://a.b/c"), t("]"))] },
  { name: "masked link", src: "[text](https://example.com)", ast: [para(link("https://example.com", [t("text")], true))] },
  { name: "masked link label is parsed inline", src: "[**b**](https://x.y)", ast: [para(link("https://x.y", [strong(t("b"))], true))] },
  { name: "masked link with angle brackets suppresses the embed", src: "[text](<https://example.com>)", ast: [para(link("https://example.com", [t("text")], true, true))] },
  { name: "masked link naming its own site stays masked", src: "[example.com/docs](https://www.example.com/docs)", ast: [para(link("https://www.example.com/docs", [t("example.com/docs")], true))] },
  { name: "masked link naming a subdomain's parent stays masked", src: "[example.com](https://docs.example.com)", ast: [para(link("https://docs.example.com", [t("example.com")], true))] },
  { name: "masked link naming another site shows where it goes", src: "[bank.example](https://elsewhere.example/login)", ast: [para(t("bank.example"), t(" ("), link("https://elsewhere.example/login"), t(")"))] },
  // the address in the label becomes a link to itself, so each link goes where it says
  { name: "masked link with a full address as its label shows where it goes", src: "[https://bank.example/login](https://elsewhere.example)", ast: [para(link("https://bank.example/login"), t(" ("), link("https://elsewhere.example"), t(")"))] },
  { name: "javascript masked link stays text", src: "[text](javascript:alert(1))", ast: [para(t("[text](javascript:alert(1))"))] },
  { name: "angle bracket url is a no-embed link", src: "<https://example.com>", ast: [para(link("https://example.com", [t("https://example.com")], false, true))] },
  { name: "url inside code is not linked", src: "`https://a.b`", ast: [para(code("https://a.b"))] },
  { name: "masked and bare link together", src: "[a](https://x.y) and https://z.w", ast: [para(link("https://x.y", [t("a")], true), t(" and "), link("https://z.w"))] },

  // --- mentions -----------------------------------------------------------
  { name: "user mention", src: "<@123>", ast: [para(user("123"))] },
  { name: "legacy nickname mention", src: "<@!456>", ast: [para(user("456"))] },
  { name: "mention inside a sentence", src: "hi <@123> there", ast: [para(t("hi "), user("123"), t(" there"))] },
  { name: "channel mention", src: "<#789>", ast: [para(channel("789"))] },
  { name: "role mention", src: "<@&42>", ast: [para(role("42"))] },
  { name: "everyone", src: "@everyone", ast: [para(everyone)] },
  { name: "here", src: "@here now", ast: [para(here, t(" now"))] },
  { name: "everyone after a word char is literal", src: "email@everyone", ast: [para(t("email@everyone"))] },
  { name: "non numeric mention is literal", src: "<@abc>", ast: [para(t("<@abc>"))] },
  { name: "unterminated mention is literal", src: "<@123", ast: [para(t("<@123"))] },

  // --- custom + unicode emoji ---------------------------------------------
  { name: "custom emoji", src: "<:smile:123>", ast: [para(emoji("smile", "123"))] },
  { name: "animated custom emoji", src: "<a:party:456>", ast: [para(emoji("party", "456", true))] },
  { name: "custom emoji name that is too short is literal", src: "<:a:123>", ast: [para(t("<:a:123>"))] },
  { name: "unicode emoji", src: "\u{1F600}", ast: [para(uni("\u{1F600}"))] },
  { name: "zwj family is one emoji", src: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", ast: [para(uni("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}"))] },
  { name: "regional indicator flag", src: "\u{1F1FA}\u{1F1F8}", ast: [para(uni("\u{1F1FA}\u{1F1F8}"))] },
  { name: "keycap", src: "1\uFE0F\u20E3", ast: [para(uni("1\uFE0F\u20E3"))] },
  { name: "skin tone modifier", src: "\u{1F44D}\u{1F3FD}", ast: [para(uni("\u{1F44D}\u{1F3FD}"))] },
  { name: "digits are never emoji", src: "1", ast: [para(t("1"))] },
  { name: "emoji between text", src: "a\u{1F600}b", ast: [para(t("a"), uni("\u{1F600}"), t("b"))] },
  { name: "two emoji are two nodes", src: "\u{1F600}\u{1F601}", ast: [para(uni("\u{1F600}"), uni("\u{1F601}"))] },
  // symbols that are text unless they ask to be emoji
  { name: "a trademark sign stays text", src: "Nexa™ and © 2026", ast: [para(t("Nexa™ and © 2026"))] },
  { name: "an arrow stays text", src: "a ↔ b ▶", ast: [para(t("a ↔ b ▶"))] },
  { name: "a text symbol with FE0F is an emoji", src: "❤️", ast: [para(uni("❤️"))] },
  { name: "a text symbol with a skin tone is an emoji", src: "✌\u{1F3FD}", ast: [para(uni("✌\u{1F3FD}"))] },
  { name: "a flag made of a text symbol and FE0F is one emoji", src: "\u{1F3F3}️‍\u{1F308}", ast: [para(uni("\u{1F3F3}️‍\u{1F308}"))] },
  { name: "a joined sequence missing its FE0F is still one emoji", src: "\u{1F3F3}\u200D\u{1F308} \u{1F441}\u200D\u{1F5E8}", ast: [para(uni("\u{1F3F3}\u200D\u{1F308}"), t(" "), uni("\u{1F441}\u200D\u{1F5E8}"))] },
  { name: "a text symbol joined to a letter stays text", src: "©\u200Da", ast: [para(t("©\u200Da"))] },
  { name: "a lone skin tone is not an emoji", src: "\u{1F3FD}", ast: [para(t("\u{1F3FD}"))] },

  // --- timestamps ---------------------------------------------------------
  { name: "timestamp defaults to f", src: "<t:1700000000>", ast: [para(ts(1700000000, "f"))] },
  { name: "relative timestamp", src: "<t:1700000000:R>", ast: [para(ts(1700000000, "R"))] },
  { name: "epoch relative timestamp", src: "<t:0:R>", ast: [para(ts(0, "R"))] },
  { name: "unknown timestamp style is literal", src: "<t:123:Z>", ast: [para(t("<t:123:Z>"))] },
  { name: "non numeric timestamp is literal", src: "<t:abc>", ast: [para(t("<t:abc>"))] },

  // --- rules --------------------------------------------------------------
  { name: "dash rule", src: "---", ast: [hr] },
  { name: "star rule", src: "***", ast: [hr] },
  { name: "underscore rule", src: "___", ast: [hr] },
  { name: "spaced rule", src: "- - -", ast: [hr] },
  { name: "a rule between paragraphs, never a heading underline", src: "a\n---\nb", ast: [para(t("a")), hr, para(t("b"))] },
  { name: "two dashes are text", src: "--", ast: [para(t("--"))] },
  { name: "dashes with words are text", src: "--- a", ast: [para(t("--- a"))] },
  { name: "an escaped rule is text", src: "\\---", ast: [para(t("---"))] },
  { name: "bold italic is not a rule", src: "***a***", ast: [para(strong(em(t("a"))))] },

  // --- nested lists --------------------------------------------------------
  { name: "three levels", src: "- a\n  - b\n    - c", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b"), list(false, 1, [[t("c")]])]])]])] },
  { name: "four spaces nest too", src: "- a\n    - b", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b")]])]])] },
  { name: "a tab nests", src: "- a\n\t- b", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b")]])]])] },
  { name: "backing out two levels", src: "- a\n  - b\n    - c\n- d", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b"), list(false, 1, [[t("c")]])]])], [t("d")]])] },
  { name: "a less indented item joins the list it is still inside", src: "- a\n    - b\n  - c", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b")], [t("c")]])]])] },
  // someone writing "+ and add answer" meant a plus, not a bullet
  { name: "a plus is not a bullet", src: "+ a\n+ b", ast: [para(t("+ a"), br, t("+ b"))] },
  { name: "ordered with a parenthesis", src: "1) a\n2) b", ast: [list(true, 1, [[t("a")], [t("b")]])] },
  { name: "ordered inside ordered", src: "1. a\n   1. b\n2. c", ast: [list(true, 1, [[t("a"), list(true, 1, [[t("b")]])], [t("c")]])] },
  { name: "a bullet list then an ordered one in the same item", src: "- a\n  - b\n  1. c", ast: [list(false, 1, [[t("a"), list(false, 1, [[t("b")]]), list(true, 1, [[t("c")]])]])] },

  // --- task lists ----------------------------------------------------------
  { name: "task list", src: "- [ ] todo\n- [x] done", ast: [list(false, 1, [[task(false), t("todo")], [task(true), t("done")]])] },
  { name: "capital X ticks too", src: "- [X] done", ast: [list(false, 1, [[task(true), t("done")]])] },
  { name: "task in an ordered list", src: "1. [ ] a", ast: [list(true, 1, [[task(false), t("a")]])] },
  { name: "empty task", src: "- [ ]", ast: [list(false, 1, [[task(false)]])] },
  { name: "nested task", src: "- [x] a\n  - [ ] b", ast: [list(false, 1, [[task(true), t("a"), list(false, 1, [[task(false), t("b")]])]])] },
  { name: "a link is not a task", src: "- [x](https://a.b)", ast: [list(false, 1, [[link("https://a.b", [t("x")], true)]])] },
  { name: "brackets without a space are text", src: "- [x]y", ast: [list(false, 1, [[t("[x]y")]])] },

  // --- tables --------------------------------------------------------------
  { name: "table", src: "| a | b |\n|---|---|\n| 1 | 2 |", ast: [table([null, null], [[t("a")], [t("b")]], [[[t("1")], [t("2")]]])] },
  { name: "table alignment", src: "|l|c|r|n|\n|:-|:-:|-:|-|", ast: [table(["left", "center", "right", null], [[t("l")], [t("c")], [t("r")], [t("n")]], [])] },
  { name: "table without outer pipes", src: "a | b\n--|--\n1 | 2", ast: [table([null, null], [[t("a")], [t("b")]], [[[t("1")], [t("2")]]])] },
  { name: "table cells are parsed inline", src: "| **b** | `c|d` |\n|---|---|", ast: [table([null, null], [[strong(t("b"))], [code("c|d")]], [])] },
  { name: "an escaped pipe stays in its cell", src: "| a \\| b |\n|---|", ast: [table([null], [[t("a | b")]], [])] },
  { name: "a spoiler stays in its cell", src: "| ||x|| | y |\n|---|---|", ast: [table([null, null], [[spoiler(t("x"))], [t("y")]], [])] },
  { name: "short rows are padded and long ones cut", src: "| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |", ast: [table([null, null], [[t("a")], [t("b")]], [[[t("1")], []], [[t("1")], [t("2")]]])] },
  { name: "a table ends at a line without a pipe", src: "| a |\n|---|\n| 1 |\ntext", ast: [table([null], [[t("a")]], [[[t("1")]]]), para(t("text"))] },
  { name: "a table ends at a blank line", src: "| a |\n|---|\n\n| 1 |", ast: [table([null], [[t("a")]], []), para(br, t("| 1 |"))] },
  { name: "header and delimiter must agree", src: "| a | b |\n|---|", ast: [para(t("| a | b |"), br, t("|---|"))] },
  { name: "a table can follow text", src: "hi\n| a |\n|---|", ast: [para(t("hi")), table([null], [[t("a")]], [])] },
  { name: "a delimiter row alone is text", src: "|---|", ast: [para(t("|---|"))] },
  { name: "a list item is not a table header", src: "- a | b\n--|--", ast: [list(false, 1, [[t("a | b")]]), para(t("--|--"))] },

  // --- callouts ------------------------------------------------------------
  { name: "note", src: "> [!NOTE]\n> Read this", ast: [alert("note", para(t("Read this")))] },
  { name: "tip", src: "> [!TIP]\n> x", ast: [alert("tip", para(t("x")))] },
  { name: "important", src: "> [!IMPORTANT]\n> x", ast: [alert("important", para(t("x")))] },
  { name: "warning", src: "> [!WARNING]\n> x", ast: [alert("warning", para(t("x")))] },
  { name: "caution", src: "> [!CAUTION]\n> x", ast: [alert("caution", para(t("x")))] },
  { name: "callout kinds ignore case", src: "> [!tip]\n> x", ast: [alert("tip", para(t("x")))] },
  { name: "words on the marker line", src: "> [!WARNING] Back up first", ast: [alert("warning", para(t("Back up first")))] },
  { name: "a callout holds blocks", src: "> [!NOTE]\n> - a\n> - b\n>\n> **c**", ast: [alert("note", list(false, 1, [[t("a")], [t("b")]]), para(br, strong(t("c"))))] },
  { name: "the marker only counts on the first line", src: "> a\n> [!NOTE]", ast: [quote(t("a"), br, t("[!NOTE]"))] },
  { name: "an unknown kind is a quote", src: "> [!DANGER]\n> x", ast: [quote(t("[!DANGER]"), br, t("x"))] },
  { name: "an empty callout", src: "> [!CAUTION]", ast: [alert("caution")] },
  { name: "a block quote can be a callout", src: ">>> [!TIP]\nrest\n- a", ast: [alert("tip", para(t("rest")), list(false, 1, [[t("a")]]))] },
  { name: "a callout ends where the quote does", src: "> [!NOTE]\n> x\ny", ast: [alert("note", para(t("x"))), para(t("y"))] },

  // --- collapsible sections -------------------------------------------------
  { name: "details", src: "::: details Logs\nline 1\nline 2\n:::", ast: [details([t("Logs")], para(t("line 1"), br, t("line 2")))] },
  { name: "details without a summary", src: "::: details\nx\n:::", ast: [details([], para(t("x")))] },
  { name: "an unclosed section runs to the end", src: "::: details S\nx", ast: [details([t("S")], para(t("x")))] },
  { name: "sections nest", src: "::: details A\n::: details B\nx\n:::\ny\n:::", ast: [details([t("A")], details([t("B")], para(t("x"))), para(t("y")))] },
  { name: "a ::: inside code does not close it", src: "::: details A\n```\n:::\n```\n:::", ast: [details([t("A")], codeblock(null, ":::"))] },
  { name: "text after a section", src: "::: details A\nx\n:::\nafter", ast: [details([t("A")], para(t("x"))), para(t("after"))] },
  { name: "details ignores case", src: ":::DETAILS **A**\nx\n:::", ast: [details([strong(t("A"))], para(t("x")))] },
  { name: "a section holds blocks", src: "::: details A\n# h\n- i\n:::", ast: [details([t("A")], heading(1, t("h")), list(false, 1, [[t("i")]]))] },
  { name: "other ::: lines are text", src: "::: nope", ast: [para(t("::: nope"))] },
  { name: "an empty section", src: "::: details A\n:::", ast: [details([t("A")])] },

  // --- highlight -----------------------------------------------------------
  { name: "highlight", src: "==hi==", ast: [para(mark(t("hi")))] },
  { name: "highlight in a sentence", src: "a ==b== c", ast: [para(t("a "), mark(t("b")), t(" c"))] },
  { name: "comparisons stay text", src: "x == y and a==b==c", ast: [para(t("x == y and a==b==c"))] },
  { name: "an unclosed highlight is text", src: "==x", ast: [para(t("==x"))] },
  { name: "three equals signs are text", src: "===x===", ast: [para(t("===x==="))] },
  { name: "highlight holds formatting", src: "==**b**==", ast: [para(mark(strong(t("b"))))] },
  { name: "an escaped highlight is text", src: "\\==x==", ast: [para(t("==x=="))] },

  // --- superscript and subscript -------------------------------------------
  { name: "superscript", src: "x^{2}", ast: [para(t("x"), sup(t("2")))] },
  { name: "subscript", src: "H_{2}O", ast: [para(t("H"), sub(t("2")), t("O"))] },
  { name: "superscript holds formatting", src: "^{**b**}", ast: [para(sup(strong(t("b"))))] },
  { name: "braces nest", src: "e^{x^{2}}", ast: [para(t("e"), sup(t("x"), sup(t("2"))))] },
  { name: "an unclosed superscript is text", src: "x^{2", ast: [para(t("x^{2"))] },
  { name: "an empty superscript is text", src: "x^{}", ast: [para(t("x^{}"))] },
  { name: "a smiley stays a smiley", src: "^_^ ^-^", ast: [para(t("^_^ ^-^"))] },
  { name: "strike and subscript side by side", src: "~~a~~ _{b}", ast: [para(s(t("a")), t(" "), sub(t("b")))] },
  { name: "an escaped superscript is text", src: "x\\^{2}", ast: [para(t("x^{2}"))] },

  // --- colours -------------------------------------------------------------
  { name: "coloured words", src: "[warning]{red}", ast: [para(color("red", null, t("warning")))] },
  { name: "short hex", src: "[x]{#F80}", ast: [para(color("#ff8800", null, t("x")))] },
  { name: "long hex", src: "[x]{#FF8800}", ast: [para(color("#ff8800", null, t("x")))] },
  { name: "highlight colour", src: "[x]{on yellow}", ast: [para(color(null, "yellow", t("x")))] },
  { name: "text and highlight colour", src: "[x]{red on yellow}", ast: [para(color("red", "yellow", t("x")))] },
  { name: "grey is gray", src: "[x]{Grey}", ast: [para(color("gray", null, t("x")))] },
  { name: "an unknown colour is text", src: "[x]{rde}", ast: [para(t("[x]{rde}"))] },
  { name: "too many words is text", src: "[x]{red on yellow now}", ast: [para(t("[x]{red on yellow now}"))] },
  { name: "a space before the braces is text", src: "[x] {red}", ast: [para(t("[x] {red}"))] },
  { name: "coloured words hold formatting", src: "[**b**]{blue}", ast: [para(color("blue", null, strong(t("b"))))] },
  { name: "a link in colour", src: "[[a](https://x.y)]{red}", ast: [para(color("red", null, link("https://x.y", [t("a")], true)))] },
  { name: "colour in a link", src: "[[a]{red}](https://x.y)", ast: [para(link("https://x.y", [color("red", null, t("a"))], true))] },
  { name: "a label with an open bracket still links as before", src: "[a[b](https://x.y)", ast: [para(link("https://x.y", [t("a[b")], true))] },
  { name: "escaped coloured words are text", src: "\\[x]{red}", ast: [para(t("[x]{red}"))] },
  { name: "balanced parentheses in a link's address", src: "[wiki](https://w.org/A_(b))", ast: [para(link("https://w.org/A_(b)", [t("wiki")], true))] },

  // --- footnotes -----------------------------------------------------------
  { name: "footnote", src: "text[^1]\n[^1]: the note", ast: [para(t("text"), fnref("1", 1)), footnotes(["1", 1, [t("the note")]])] },
  { name: "footnotes are numbered as they are referred to", src: "b[^b] a[^a]\n[^a]: A\n[^b]: B", ast: [para(t("b"), fnref("b", 1), t(" a"), fnref("a", 2)), footnotes(["b", 1, [t("B")]], ["a", 2, [t("A")]])] },
  { name: "a reference without a note is text", src: "x[^nope]", ast: [para(t("x[^nope]"))] },
  { name: "a note nothing refers to stays as typed", src: "[^1]: lonely", ast: [para(t("[^1]: lonely"))] },
  { name: "two references to one note", src: "a[^x] b[^x]\n[^x]: X", ast: [para(t("a"), fnref("x", 1), t(" b"), fnref("x", 1)), footnotes(["x", 1, [t("X")]])] },
  { name: "labels ignore case", src: "a[^Note]\n[^note]: N", ast: [para(t("a"), fnref("Note", 1)), footnotes(["note", 1, [t("N")]])] },
  { name: "a note may refer to a note", src: "a[^1]\n[^1]: see[^2]\n[^2]: two", ast: [para(t("a"), fnref("1", 1)), footnotes(["1", 1, [t("see"), fnref("2", 2)]], ["2", 2, [t("two")]])] },
  { name: "previews have no footnotes", src: "a[^1]", ast: [t("a[^1]")], inline: true },
  { name: "an escaped reference is text", src: "\\[^1]\n[^1]: n", ast: [para(t("[^1]")), para(t("[^1]: n"))] },

  // --- escapes for the block markers ---------------------------------------
  { name: "escaped heading", src: "\\# not a heading", ast: [para(t("# not a heading"))] },
  { name: "escaped quote", src: "\\> not a quote", ast: [para(t("> not a quote"))] },
  { name: "escaped bullet", src: "\\- not a list", ast: [para(t("- not a list"))] },
  { name: "escaped number", src: "1\\. not a list", ast: [para(t("1. not a list"))] },
  { name: "escaped section", src: "\\::: details", ast: [para(t("::: details"))] },
  { name: "escaped subscript", src: "a\\_{b}", ast: [para(t("a_{b}"))] },

  // --- inline mode --------------------------------------------------------
  { name: "inline mode disables headings", src: "# hi", ast: [t("# hi")], inline: true },
  { name: "inline mode disables lists", src: "- item", ast: [t("- item")], inline: true },
  { name: "inline mode disables quotes", src: "> q", ast: [t("> q")], inline: true },
  { name: "inline mode keeps line breaks", src: "a\nb", ast: [t("a"), br, t("b")], inline: true },
  { name: "inline mode keeps inline formatting", src: "**b** <@1>", ast: [strong(t("b")), t(" "), user("1")], inline: true },
  { name: "inline mode disables fences", src: "```\nx\n```", ast: [t("```"), br, t("x"), br, t("```")], inline: true },
  { name: "inline mode disables tables", src: "| a |\n|---|", ast: [t("| a |"), br, t("|---|")], inline: true },
  { name: "inline mode disables callouts", src: "> [!NOTE]", ast: [t("> [!NOTE]")], inline: true },
  { name: "inline mode keeps colours and highlights", src: "[a]{red} ==b==", ast: [color("red", null, t("a")), t(" "), mark(t("b"))], inline: true },

  // --- combinations -------------------------------------------------------
  { name: "everything at once", src: "# t\n> q\n- i\n`c`", ast: [heading(1, t("t")), quote(t("q")), list(false, 1, [[t("i")]]), para(code("c"))] },
  { name: "spoilered link", src: "||https://a.b||", ast: [para(spoiler(link("https://a.b")))] },
  { name: "mention inside bold", src: "**<@1>**", ast: [para(strong(user("1")))] },
];

describe("parse fixtures", () => {
  it.each(fixtures)("$name", ({ src, ast, inline }) => {
    expect(parse(src, inline === undefined ? undefined : { inline })).toEqual(ast);
  });

  it("has at least 80 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// fuzz
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  "*", "**", "***", "_", "__", "~~", "||", "`", "``", "```", "\\", "\n", "\n\n", " ", "a", "b", "Z", "9",
  "<", ">", "@", "#", ":", "[", "]", "(", ")", "-", "1.", "> ", ">>> ", "# ", "-# ", "<@1", "<@123>", "<#5>",
  "<:ab:1>", "<t:0:R>", "@everyone", "@here", "https://a.b/c", "\u{1F600}", "\u{1F1FA}\u{1F1F8}", "\u200D",
  "\uFE0F", "javascript:", "&", "\"", "'", "\t",
];

describe("fuzz", () => {
  it("parses 500 random strings without throwing", () => {
    const rand = mulberry32(0xc0ffee);
    for (let n = 0; n < 500; n++) {
      const target = Math.floor(rand() * 4000);
      let src = "";
      while (src.length < target) {
        const piece = ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? "a";
        src += piece;
      }
      src = src.slice(0, 4000);
      const inline = rand() < 0.3;
      let nodes: Node[];
      try {
        nodes = parse(src, { inline });
      } catch (err) {
        throw new Error(`parse threw on seed ${n}: ${String(err)}\n${JSON.stringify(src)}`);
      }
      expect(Array.isArray(nodes)).toBe(true);
      expect(typeof plainText(nodes)).toBe("string");
      expect(typeof isEmojiOnly(nodes)).toBe("boolean");
      expect(Array.isArray(extractUrls(src))).toBe(true);
    }
  });

  it("is fast on pathological marker soup", () => {
    const started = Date.now();
    parse("*a ".repeat(1300));
    parse("`".repeat(3999));
    parse("||".repeat(1999));
    parse("_a".repeat(1999));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is fast on long hand-built messages", () => {
    const started = Date.now();
    parse("https://a" + ")".repeat(32000));
    parse("https://a" + "]".repeat(32000));
    parse("a" + " ".repeat(32000) + "b");
    parse("[".repeat(32000));
    parse("[a](" + "x".repeat(32000));
    extractUrls("https://a" + ")".repeat(64000));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("is fast on the newer markers", () => {
    const started = Date.now();
    parse("==a ".repeat(2000));
    parse("^{".repeat(4000));
    parse("_{".repeat(4000));
    parse("[a]".repeat(2600) + "{red}");
    parse("[x]{".repeat(2000));
    parse("[[[[" + "a]".repeat(3000));
    parse("| a ".repeat(2000) + "\n" + "|---".repeat(2000));
    parse("| a | b |\n|---|---|\n".repeat(400));
    parse("||x||".repeat(1600) + "\n|---|");
    parse("> [!NOTE]\n".repeat(800));
    parse("::: details a\n".repeat(600));
    parse(":::\n".repeat(2000));
    parse(Array.from({ length: 800 }, (_, i) => " ".repeat(i % 60) + "- x").join("\n"));
    parse("> ".repeat(3000) + "[!NOTE]");
    parse("[^1]".repeat(2000) + "\n[^1]: x");
    parse(Array.from({ length: 400 }, (_, i) => `[^${i}]: n[^${i + 1}]`).join("\n") + "\n" + Array.from({ length: 400 }, (_, i) => `[^${i}]`).join(" "));
    parse("- [ ] ".repeat(1000));
    parse("# " + "#".repeat(7000));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("caps how deep callouts, sections and lists nest", () => {
    const depthOf = (nodes: Node[], kind: string): number => {
      let best = 0;
      for (const node of nodes) {
        let inner: Node[] = [];
        if (node.type === "alert" || node.type === "details") inner = node.children;
        if (node.type === "list") inner = node.items.flat();
        const d = (node.type === kind ? 1 : 0) + depthOf(inner, kind);
        if (d > best) best = d;
      }
      return best;
    };
    const callouts = Array.from({ length: 12 }, (_, d) => "> ".repeat(d + 1) + "[!NOTE]").join("\n");
    expect(depthOf(parse(callouts), "alert")).toBe(4);
    expect(depthOf(parse("::: details a\n".repeat(20)), "details")).toBe(4);
    const lists = Array.from({ length: 20 }, (_, d) => "  ".repeat(d) + "- x").join("\n");
    expect(depthOf(parse(lists), "list")).toBe(6);
  });

  it("never lets a table grow past its columns", () => {
    const head = "|" + " a |".repeat(100);
    const delim = "|" + "---|".repeat(100);
    const [node] = parse(head + "\n" + delim);
    expect(node?.type).toBe("para" + "graph");
    const [ok] = parse("|" + " a |".repeat(24) + "\n|" + "---|".repeat(24) + "\n|" + " 1 |".repeat(60));
    expect(ok?.type === "table" && ok.rows[0]?.length).toBe(24);
  });

  it("still trims unbalanced closing brackets off a url", () => {
    expect(extractUrls("(https://a.b/x_(y))).")).toEqual(["https://a.b/x_(y)"]);
    expect(extractUrls("[https://a.b/[1]]]")).toEqual(["https://a.b/[1]"]);
  });
});

// ---------------------------------------------------------------------------
// isEmojiOnly
// ---------------------------------------------------------------------------
describe("isEmojiOnly", () => {
  it("is true for a single unicode emoji", () => {
    expect(isEmojiOnly(parse("\u{1F600}"))).toBe(true);
  });
  it("is true for several emoji separated by spaces and newlines", () => {
    expect(isEmojiOnly(parse("\u{1F600} \u{1F601}\n\u{1F602}"))).toBe(true);
  });
  it("is true for custom emoji", () => {
    expect(isEmojiOnly(parse("<:ab:1><a:cd:2>"))).toBe(true);
  });
  it("is false when text is mixed in", () => {
    expect(isEmojiOnly(parse("hi \u{1F600}"))).toBe(false);
  });
  it("is false for an empty message", () => {
    expect(isEmojiOnly(parse(""))).toBe(false);
  });
  it("is false with more than 30 emoji", () => {
    expect(isEmojiOnly(parse("\u{1F600}".repeat(30)))).toBe(true);
    expect(isEmojiOnly(parse("\u{1F600}".repeat(31)))).toBe(false);
  });
  it("is false when the emoji are wrapped in formatting", () => {
    expect(isEmojiOnly(parse("**\u{1F600}**"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plainText
// ---------------------------------------------------------------------------
describe("plainText", () => {
  it("keeps plain words", () => {
    expect(plainText(parse("hello world"))).toBe("hello world");
  });
  it("drops formatting markers", () => {
    expect(plainText(parse("**a** *b* ~~c~~"))).toBe("a b c");
  });
  it("hides what a spoiler covers", () => {
    expect(plainText(parse("the butler ||did it||", { inline: true }))).toBe("the butler [spoiler]");
  });
  it("renders unresolved mentions by id", () => {
    expect(plainText(parse("<@12> <#34> <@&56>"))).toBe("@12 #34 @56");
  });
  it("keeps everyone and here", () => {
    expect(plainText(parse("@everyone @here"))).toBe("@everyone @here");
  });
  it("renders custom emoji as a shortcode", () => {
    expect(plainText(parse("<:smile:1>"))).toBe(":smile:");
  });
  it("keeps unicode emoji as is", () => {
    expect(plainText(parse("\u{1F600}"))).toBe("\u{1F600}");
  });
  it("keeps code verbatim", () => {
    expect(plainText(parse("`a*b`"))).toBe("a*b");
    expect(plainText(parse("```js\nx\n```"))).toBe("x");
  });
  it("writes mentions as names when it is given them", () => {
    const src = "thanks <@123> in <#456> for <@&789> and <@999>";
    expect(plainText(parse(src, { inline: true }))).toBe("thanks @123 in #456 for @789 and @999");
    const names = { users: { "123": { display_name: "Alice", username: "alice" } }, channels: { "456": { name: "general" } }, roles: { "789": { name: "mods", color: 0 } } };
    expect(plainText(parse(src, { inline: true }), names)).toBe("thanks @Alice in #general for @mods and @unknown-user");
  });
  it("renders links as their url", () => {
    expect(plainText(parse("[label](https://a.b)"))).toBe("https://a.b");
    expect(plainText(parse("https://a.b"))).toBe("https://a.b");
  });
  it("turns breaks and blocks into newlines", () => {
    expect(plainText(parse("a\nb"))).toBe("a\nb");
    expect(plainText(parse("# h\ntext"))).toBe("h\ntext");
    expect(plainText(parse("- a\n- b"))).toBe("a\nb");
    expect(plainText(parse("- a\n  - b\n- c"))).toBe("a\nb\nc");
  });
  it("returns an empty string for an empty message", () => {
    expect(plainText(parse(""))).toBe("");
  });
  it("reads headings, rules and checklists as plain lines", () => {
    expect(plainText(parse("#### Four\n---\nafter"))).toBe("Four\n---\nafter");
    expect(plainText(parse("- [ ] milk\n- [x] eggs"))).toBe("☐ milk\n☑ eggs");
  });
  it("reads a table row by row", () => {
    expect(plainText(parse("| a | b |\n|---|---|\n| 1 | **2** |"))).toBe("a | b\n1 | 2");
  });
  it("names a callout in the reader's language", () => {
    expect(plainText(parse("> [!WARNING]\n> Back up first"))).toBe("Warning: Back up first");
    expect(plainText(parse("> [!TIP]"))).toBe("Tip");
    expect(plainText(parse("before\n> [!NOTE]\n> - a\n> - b"))).toBe("before\nNote: a\nb");
  });
  it("keeps a folded section's words, so search finds them", () => {
    expect(plainText(parse("::: details Logs\nline one\n:::"))).toBe("Logs\nline one");
    expect(plainText(parse("::: details\nline\n:::"))).toBe("Details\nline");
  });
  it("drops the colour, highlight and script markers", () => {
    expect(plainText(parse("E = mc^{2}, H_{2}O, ==key==, [red words]{red on yellow}"))).toBe("E = mc2, H2O, key, red words");
  });
  it("numbers footnotes and lists them at the end", () => {
    expect(plainText(parse("a[^x] b\n[^x]: the note"))).toBe("a[1] b\n[1] the note");
  });
  it("still hides a spoiler inside the new blocks", () => {
    expect(plainText(parse("> [!NOTE]\n> ||secret||"))).toBe("Note: [spoiler]");
    expect(plainText(parse("| ||secret|| |\n|---|"))).toBe("[spoiler]");
  });
});

// ---------------------------------------------------------------------------
// extractUrls
// ---------------------------------------------------------------------------
describe("extractUrls", () => {
  it("collects bare urls in order", () => {
    expect(extractUrls("https://a.b then https://c.d")).toEqual(["https://a.b", "https://c.d"]);
  });
  it("collects masked urls", () => {
    expect(extractUrls("[x](https://a.b)")).toEqual(["https://a.b"]);
  });
  it("dedupes", () => {
    expect(extractUrls("https://a.b https://a.b")).toEqual(["https://a.b"]);
  });
  it("skips no-embed links", () => {
    expect(extractUrls("<https://a.b> https://c.d")).toEqual(["https://c.d"]);
    expect(extractUrls("[x](<https://a.b>)")).toEqual([]);
  });
  it("skips urls inside code", () => {
    expect(extractUrls("`https://a.b`")).toEqual([]);
    expect(extractUrls("```\nhttps://a.b\n```")).toEqual([]);
  });
  it("skips non http schemes", () => {
    expect(extractUrls("ftp://a.b javascript:alert(1)")).toEqual([]);
  });
  it("caps at 5", () => {
    const src = ["https://a1.b", "https://a2.b", "https://a3.b", "https://a4.b", "https://a5.b", "https://a6.b"].join(" ");
    expect(extractUrls(src)).toHaveLength(5);
  });
  it("skips urls inside a spoiler", () => {
    expect(extractUrls("||https://a.b/ending.png|| https://c.d")).toEqual(["https://c.d"]);
  });
  it("returns an empty array when there is nothing to find", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });
  it("finds links in tables, callouts, colours and footnotes", () => {
    const src = "| https://a.b |\n|---|\n> [!NOTE]\n> https://c.d\n\n[==https://e.f==]{red} x[^1]\n[^1]: https://g.h";
    expect(extractUrls(src)).toEqual(["https://a.b", "https://c.d", "https://e.f", "https://g.h"]);
  });
  it("skips links folded away in a section", () => {
    expect(extractUrls("::: details\nhttps://a.b\n:::\nhttps://c.d")).toEqual(["https://c.d"]);
  });
});
