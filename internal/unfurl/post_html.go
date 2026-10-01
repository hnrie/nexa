package unfurl

// Reading a post out of markup.
//
// Mastodon, Telegram and Reddit give a post's words as HTML. None of it is
// passed on: the app draws text, so the markup is read for what it says (its
// lines and paragraphs, and where its links go) and then dropped.

import (
	"bytes"
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// parseFragment parses a piece of a page, as it would sit in a <body>.
func parseFragment(fragment string) []*html.Node {
	nodes, err := html.ParseFragment(strings.NewReader(fragment), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body})
	if err != nil {
		return nil
	}
	return nodes
}

func attr(n *html.Node, key string) string {
	if n == nil {
		return ""
	}
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(n *html.Node, class string) bool {
	if n == nil || n.Type != html.ElementNode {
		return false
	}
	for _, c := range strings.Fields(attr(n, "class")) {
		if c == class {
			return true
		}
	}
	return false
}

// walk visits n and everything under it until visit returns false.
func walk(n *html.Node, visit func(*html.Node) bool) bool {
	if n == nil {
		return true
	}
	if !visit(n) {
		return false
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if !walk(c, visit) {
			return false
		}
	}
	return true
}

// each visits n and everything under it; visit says whether to look inside
// the node it was given.
func each(n *html.Node, visit func(*html.Node) bool) {
	if n == nil || !visit(n) {
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		each(c, visit)
	}
}

// findClass is the first element under root (or root itself) with a class.
func findClass(root *html.Node, class string) *html.Node {
	var found *html.Node
	walk(root, func(n *html.Node) bool {
		if hasClass(n, class) {
			found = n
			return false
		}
		return true
	})
	return found
}

// allClass is every element under root with a class, in document order.
func allClass(root *html.Node, class string) []*html.Node {
	var out []*html.Node
	walk(root, func(n *html.Node) bool {
		if hasClass(n, class) {
			out = append(out, n)
		}
		return true
	})
	return out
}

// findTag is the first element under root with a tag name.
func findTag(root *html.Node, tag string) *html.Node {
	var found *html.Node
	walk(root, func(n *html.Node) bool {
		if n.Type == html.ElementNode && n.Data == tag {
			found = n
			return false
		}
		return true
	})
	return found
}

// plain is the text under a node on one line, for a name or a count.
func plain(n *html.Node) string {
	var b strings.Builder
	walk(n, func(c *html.Node) bool {
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
		}
		return true
	})
	return collapse(b.String())
}

type textReader struct {
	buf   []byte
	links []PostLink
	base  *url.URL
	// breaks is how many line breaks are owed before the next words: one for
	// a new line, two for a blank line between paragraphs. space is a single
	// space owed the same way. Neither is written until words follow, so the
	// text never starts or ends with them and no line ends in a space.
	breaks int
	space  bool
	pre    int
	// mark asks for the place the next words land at, for a link's label.
	mark  bool
	start int
	// skip leaves a part of the markup out, where a page mixes a post's
	// words with its own (a caption that starts with the author's name).
	skip func(*html.Node) bool
}

func (r *textReader) owe(n int) {
	if len(r.buf) > 0 && r.breaks < n {
		r.breaks = n
	}
}

// flush writes what is owed before words.
func (r *textReader) flush(lead bool) {
	switch {
	case r.breaks > 0:
		for ; r.breaks > 0; r.breaks-- {
			r.buf = append(r.buf, '\n')
		}
	case (r.space || lead) && len(r.buf) > 0:
		r.buf = append(r.buf, ' ')
	}
	r.space = false
	if r.mark {
		r.mark, r.start = false, len(r.buf)
	}
}

func (r *textReader) write(s string) {
	if s == "" {
		return
	}
	if r.pre > 0 {
		// as written, line breaks and all
		r.flush(false)
		r.buf = append(r.buf, s...)
		return
	}
	// runs of spaces and line breaks in the markup are one space
	words := strings.Fields(s)
	lead := unicode.IsSpace(firstRune(s))
	if len(words) == 0 {
		r.space = r.space || len(r.buf) > 0
		return
	}
	r.flush(lead)
	r.buf = append(r.buf, strings.Join(words, " ")...)
	last, _ := utf8.DecodeLastRuneInString(s)
	r.space = unicode.IsSpace(last)
}

func firstRune(s string) rune {
	r, _ := utf8.DecodeRuneInString(s)
	return r
}

func (r *textReader) node(n *html.Node) {
	switch n.Type {
	case html.TextNode:
		r.write(n.Data)
		return
	case html.ElementNode:
	default:
		return
	}
	if r.skip != nil && r.skip(n) {
		return
	}
	switch n.Data {
	case "script", "style", "template", "head", "title", "noscript", "svg":
		return
	case "br":
		// two in a row are a blank line; more are still one
		if len(r.buf) > 0 && r.breaks < 2 {
			r.breaks++
		}
		return
	case "img":
		// a custom emoji is a picture whose alt is what it says
		if alt := attr(n, "alt"); alt != "" {
			r.write(alt)
		}
		return
	case "a":
		r.mark = true
		r.children(n)
		if r.mark {
			// the link had no words
			r.mark = false
			return
		}
		label := string(r.buf[r.start:])
		if abs := r.resolve(strings.TrimSpace(attr(n, "href"))); abs != "" && label != "" && label != abs {
			r.links = append(r.links, PostLink{Text: label, URL: abs, at: r.start, placed: true})
		}
		return
	case "p", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "hr":
		r.owe(2)
		if n.Data == "pre" {
			r.pre++
		}
		r.children(n)
		if n.Data == "pre" {
			r.pre--
		}
		r.owe(2)
		return
	case "div", "li", "tr", "section", "article":
		r.owe(1)
		r.children(n)
		r.owe(1)
		return
	}
	r.children(n)
}

func (r *textReader) children(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		r.node(c)
	}
}

func (r *textReader) resolve(href string) string {
	if href == "" {
		return ""
	}
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if r.base != nil {
		ref = r.base.ResolveReference(ref)
	}
	if (ref.Scheme != "http" && ref.Scheme != "https") || ref.Host == "" {
		return ""
	}
	return ref.String()
}

// nodeText is what the markup under root says as text: a <br> is a new line
// and a <p> a new paragraph. Beside it come the links whose words are not
// their address, in order and each with its place in the text, resolved
// against base where they are relative.
func nodeText(root *html.Node, base *url.URL) (string, []PostLink) {
	return nodeTextExcept(root, base, nil)
}

// nodeTextExcept is nodeText without the elements skip picks out.
func nodeTextExcept(root *html.Node, base *url.URL, skip func(*html.Node) bool) (string, []PostLink) {
	r := &textReader{base: base, skip: skip}
	if root != nil {
		r.children(root)
	}
	return string(r.buf), r.links
}

// classHas reports whether any of an element's classes contains part.
func classHas(n *html.Node, part string) bool {
	return n != nil && n.Type == html.ElementNode && strings.Contains(attr(n, "class"), part)
}

// within reports whether n sits under an element for which is holds.
func within(n *html.Node, is func(*html.Node) bool) bool {
	for p := n.Parent; p != nil; p = p.Parent {
		if is(p) {
			return true
		}
	}
	return false
}

// largest is the widest picture of a srcset ("a.jpg 640w, b.jpg 1080w"), or "".
func largest(srcset string) string {
	best, bestW := "", -1
	for _, part := range strings.Split(srcset, ",") {
		fields := strings.Fields(part)
		if len(fields) == 0 {
			continue
		}
		w := 0
		if len(fields) > 1 {
			w, _ = strconv.Atoi(strings.TrimSuffix(fields[1], "w"))
		}
		if w > bestW {
			best, bestW = fields[0], w
		}
	}
	return best
}

// jsonStringAfter reads the JSON string that follows marker in a page's
// source, where marker ends with the string's opening quote: the value a
// script was given under some key, whatever the script around it looks like.
func jsonStringAfter(body []byte, marker string) (string, bool) {
	at := bytes.Index(body, []byte(marker))
	if at < 0 {
		return "", false
	}
	open := at + len(marker) - 1
	for i := open + 1; i < len(body); i++ {
		switch body[i] {
		case '\\':
			i++
		case '"':
			var out string
			if json.Unmarshal(body[open:i+1], &out) != nil {
				return "", false
			}
			return out, true
		}
	}
	return "", false
}

// shortcodeTime is when an Instagram or Threads post was made, read from its
// code. The code is the post's number written in base 64, and the number
// begins with the milliseconds since Instagram's own epoch, so the time needs
// no page at all. 0 for a code that is not such a number.
func shortcodeTime(code string) int64 {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	const epoch = 1314220021721
	var n uint64
	for i := 0; i < len(code); i++ {
		digit := strings.IndexByte(alphabet, code[i])
		if digit < 0 || n > (1<<58)-1 {
			return 0
		}
		n = n<<6 | uint64(digit)
	}
	ms := int64(n>>23) + epoch
	// a post from before Instagram or from next year is a code read wrong
	if n == 0 || ms > time.Now().Add(24*time.Hour).UnixMilli() {
		return 0
	}
	return ms
}

// htmlText is nodeText for markup given as a string.
func htmlText(fragment string, base *url.URL) (string, []PostLink) {
	root := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	for _, n := range parseFragment(fragment) {
		root.AppendChild(n)
	}
	return nodeText(root, base)
}

var styleURLRe = regexp.MustCompile(`url\(\s*['"]?([^'")]+)['"]?\s*\)`)

// styleURL is the address in a style's url(...), where a page draws a
// picture as a background.
func styleURL(style string) string {
	if m := styleURLRe.FindStringSubmatch(style); m != nil {
		u := strings.TrimSpace(m[1])
		if strings.HasPrefix(u, "//") {
			u = "https:" + u
		}
		return u
	}
	return ""
}

var stylePxRe = regexp.MustCompile(`(?:^|;)\s*(width|height)\s*:\s*(\d{1,5})px`)
var stylePadRe = regexp.MustCompile(`padding-top\s*:\s*([0-9.]{1,12})%`)
