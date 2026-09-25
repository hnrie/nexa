// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureTwemojiIndex, onTwemojiIndexReady, twemojiIndexSettled } from "@/lib/twemoji";
import type { RenderCtx } from "./ast";
import { Markdown, parseHighlightHtml, RenderNodes } from "./render";
import { parse } from "./parse";

function makeCtx(over: Partial<RenderCtx> = {}): RenderCtx {
  return {
    users: { "1": { display_name: "Ada", username: "ada" }, "2": { display_name: "", username: "grace" } },
    channels: { "10": { name: "general" } },
    roles: { "20": { name: "admin", color: 0xff0000 } },
    emojiUrl: (id, animated) => `https://cdn.test/emojis/${id}.${animated ? "gif" : "webp"}`,
    ...over,
  };
}

describe("spoilers", () => {
  it("stays hidden until clicked", () => {
    const { container } = render(<Markdown source="||secret||" ctx={makeCtx()} />);
    const el = container.querySelector(".md-spoiler");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-revealed")).toBe("false");
    expect(el?.textContent).toBe("secret");
    fireEvent.click(el as Element);
    expect(container.querySelector(".md-spoiler")?.getAttribute("data-revealed")).toBe("true");
  });

  it("is revealed up front when ctx.revealSpoilers is set", () => {
    const { container } = render(<Markdown source="||secret||" ctx={makeCtx({ revealSpoilers: true })} />);
    expect(container.querySelector(".md-spoiler")?.getAttribute("data-revealed")).toBe("true");
  });
});

describe("links", () => {
  it("renders bare links with safe attributes", () => {
    const { container } = render(<Markdown source="https://example.com/x" ctx={makeCtx()} />);
    const a = container.querySelector("a.md-link") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBeNull();
    expect(a.textContent).toBe("https://example.com/x");
  });

  it("gives masked links a title with the destination", () => {
    const { container } = render(<Markdown source="[click me](https://example.com/y)" ctx={makeCtx()} />);
    const a = container.querySelector("a.md-link") as HTMLAnchorElement;
    expect(a.textContent).toBe("click me");
    expect(a.getAttribute("title")).toBe("https://example.com/y");
  });

  it("never renders a javascript: masked link as an anchor", () => {
    const { container } = render(<Markdown source="[x](javascript:alert(1))" ctx={makeCtx()} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("[x](javascript:alert(1))");
  });
});

describe("mentions", () => {
  it("resolves a user display name", () => {
    const { container } = render(<Markdown source="<@1>" ctx={makeCtx()} />);
    expect(container.querySelector(".md-mention")?.textContent).toBe("@Ada");
  });

  it("falls back to the username then to unknown-user", () => {
    const { container } = render(<Markdown source="<@2> <@999>" ctx={makeCtx()} />);
    const texts = [...container.querySelectorAll(".md-mention")].map((n) => n.textContent);
    expect(texts).toEqual(["@grace", "@unknown-user"]);
  });

  it("calls onUserClick with the id and the element", () => {
    const onUserClick = vi.fn();
    const { container } = render(<Markdown source="<@1>" ctx={makeCtx({ onUserClick })} />);
    const el = container.querySelector(".md-mention") as HTMLElement;
    fireEvent.click(el);
    expect(onUserClick).toHaveBeenCalledTimes(1);
    expect(onUserClick.mock.calls[0]?.[0]).toBe("1");
    expect(onUserClick.mock.calls[0]?.[1]).toBe(el);
  });

  it("resolves channels and falls back to a quiet unknown-channel", () => {
    const onChannelClick = vi.fn();
    const { container } = render(<Markdown source="<#10> <#11>" ctx={makeCtx({ onChannelClick })} />);
    const nodes = [...container.querySelectorAll(".md-mention")];
    expect(nodes.map((n) => n.textContent)).toEqual(["#general", "#unknown-channel"]);
    expect((nodes[1] as HTMLElement).getAttribute("role")).toBeNull();
    fireEvent.click(nodes[0] as Element);
    expect(onChannelClick).toHaveBeenCalledWith("10");
  });

  it("colours role mentions, mixed toward the theme's text so they read in either theme", () => {
    const { container } = render(<Markdown source="<@&20>" ctx={makeCtx()} />);
    const el = container.querySelector(".md-mention") as HTMLElement;
    expect(el.textContent).toBe("@admin");
    expect(el.getAttribute("style") ?? "").toContain("color-mix(in srgb, #ff0000 72%, var(--text-strong))");
    expect(el.style.backgroundColor).toBe("rgba(255, 0, 0, 0.16)");
  });

  it("shows a role nobody here knows as a quiet placeholder", () => {
    const { container } = render(<Markdown source="<@&99>" ctx={makeCtx()} />);
    const el = container.querySelector(".md-mention") as HTMLElement;
    expect(el.textContent).toBe("@unknown-role");
    expect(el.dataset["roleMention"]).toBe("unknown");
  });

  it("leaves role mentions without a colour to the mention style", () => {
    const { container } = render(<Markdown source="<@&21>" ctx={makeCtx({ roles: { "21": { name: "member", color: 0 } } })} />);
    const el = container.querySelector(".md-mention") as HTMLElement;
    expect(el.textContent).toBe("@member");
    expect(el.style.color).toBe("");
    expect(el.style.backgroundColor).toBe("");
  });

  it("opens channel mentions from the keyboard", () => {
    const onChannelClick = vi.fn();
    const { container } = render(<Markdown source="<#10>" ctx={makeCtx({ onChannelClick })} />);
    const el = container.querySelector(".md-mention") as HTMLElement;
    fireEvent.keyDown(el, { key: "a" });
    expect(onChannelClick).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onChannelClick).toHaveBeenCalledWith("10");
  });

  it("renders everyone without any lookup", () => {
    const { container } = render(<Markdown source="@everyone" ctx={makeCtx()} />);
    expect(container.querySelector(".md-mention")?.textContent).toBe("@everyone");
  });
});

describe("emoji", () => {
  // pictures are only asked for once the list of what the set holds has arrived
  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(["1f600"]))));
    ensureTwemojiIndex();
    await new Promise<void>((resolve) => (twemojiIndexSettled() ? resolve() : onTwemojiIndexReady(resolve)));
    vi.unstubAllGlobals();
  });

  it("renders a custom emoji image", () => {
    const { container } = render(<Markdown source="<:smile:123>" ctx={makeCtx()} />);
    const img = container.querySelector("img.md-emoji") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.test/emojis/123.webp");
    expect(img.getAttribute("alt")).toBe(":smile:");
    expect(img.getAttribute("title")).toBe(":smile:");
    expect(img.className).not.toContain("md-emoji-jumbo");
  });

  it("uses the animated url and the jumbo class", () => {
    const { container } = render(<Markdown source="<a:party:9>" ctx={makeCtx()} jumbo />);
    const img = container.querySelector("img.md-emoji") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.test/emojis/9.gif");
    expect(img.className).toContain("md-emoji-jumbo");
  });

  it("draws a unicode emoji with the bundled twemoji artwork", () => {
    const { container } = render(<Markdown source={"\u{1F600}"} ctx={makeCtx()} jumbo />);
    const img = container.querySelector("img.md-emoji") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/twemoji/1f600.svg");
    expect(img.getAttribute("alt")).toBe("\u{1F600}");
    expect(img.className).toContain("md-emoji-jumbo");
  });

  it("falls back to the platform glyph when there is no artwork", () => {
    // A private-use character is not an emoji anyone ships a picture for.
    const { container } = render(<Markdown source={"\u{1F600}"} ctx={makeCtx()} />);
    const img = container.querySelector("img.md-emoji") as HTMLImageElement;
    fireEvent.error(img);
    const span = container.querySelector(".md-emoji-unicode") as HTMLElement;
    expect(span.textContent).toBe("\u{1F600}");
  });
});

describe("code", () => {
  it("renders inline code", () => {
    const { container } = render(<Markdown source="`a*b`" ctx={makeCtx()} />);
    const el = container.querySelector("code.md-inline-code");
    expect(el?.textContent).toBe("a*b");
  });

  it("renders an unknown language as plain text", () => {
    const { container } = render(<Markdown source={"```notalang\nlet x = 1\n```"} ctx={makeCtx()} />);
    const pre = container.querySelector("pre.md-codeblock") as HTMLElement;
    const code = pre.querySelector("code") as HTMLElement;
    expect(code.className).toBe("hljs language-notalang");
    expect(code.textContent).toBe("let x = 1");
    expect(code.querySelector("span")).toBeNull();
  });

  it("highlights a known language once highlight.js has loaded", async () => {
    const { container } = render(<Markdown source={"```js\nconst a = 1;\n```"} ctx={makeCtx()} />);
    expect(container.querySelector("pre.md-codeblock code")?.textContent).toBe("const a = 1;");
    await waitFor(() => {
      expect(container.querySelector("code .hljs-keyword")?.textContent).toBe("const");
    });
    expect(container.querySelector("pre.md-codeblock code")?.textContent).toBe("const a = 1;");
  });

  it("renders a fence without a language", () => {
    const { container } = render(<Markdown source={"```\nplain\n```"} ctx={makeCtx()} />);
    const code = container.querySelector("pre.md-codeblock code") as HTMLElement;
    expect(code.className).toBe("hljs");
    expect(code.textContent).toBe("plain");
  });
});

describe("parseHighlightHtml", () => {
  it("turns hljs output into a nested node tree", () => {
    const html = '<span class="hljs-keyword">const</span> a = <span class="hljs-string">"x"</span>;';
    expect(parseHighlightHtml(html)).toEqual([
      { type: "span", className: "hljs-keyword", children: [{ type: "text", text: "const" }] },
      { type: "text", text: " a = " },
      { type: "span", className: "hljs-string", children: [{ type: "text", text: '"x"' }] },
      { type: "text", text: ";" },
    ]);
  });

  it("handles nesting", () => {
    const html = '<span class="a"><span class="b">x</span>y</span>';
    expect(parseHighlightHtml(html)).toEqual([
      {
        type: "span",
        className: "a",
        children: [{ type: "span", className: "b", children: [{ type: "text", text: "x" }] }, { type: "text", text: "y" }],
      },
    ]);
  });

  it("unescapes entities", () => {
    expect(parseHighlightHtml("&lt;a&gt; &amp; &quot;b&quot; &#x27;c&#x27;")).toEqual([
      { type: "text", text: "<a> & \"b\" 'c'" },
    ]);
  });

  it("treats anything it does not understand as text", () => {
    expect(parseHighlightHtml('<img src=x onerror=alert(1)>hi')).toEqual([
      { type: "text", text: "<img src=x onerror=alert(1)>hi" },
    ]);
    expect(parseHighlightHtml("a</span>b")).toEqual([{ type: "text", text: "a</span>b" }]);
  });

  it("closes dangling spans", () => {
    expect(parseHighlightHtml('<span class="a">x')).toEqual([
      { type: "span", className: "a", children: [{ type: "text", text: "x" }] },
    ]);
  });

  it("renders as react spans without dangerouslySetInnerHTML", () => {
    const { container } = render(
      <div>
        {parseHighlightHtml('<span class="hljs-keyword">const</span> x').map((n, i) =>
          n.type === "span" ? (
            <span key={i} className={n.className}>
              {n.children.map((c) => (c.type === "text" ? c.text : null))}
            </span>
          ) : (
            <span key={i}>{n.text}</span>
          ),
        )}
      </div>,
    );
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });
});

describe("blocks", () => {
  it("renders headings, quotes, subtext and lists", () => {
    const src = "# Title\n> quoted\n-# small\n- a\n- b\n1. c";
    const { container } = render(<Markdown source={src} ctx={makeCtx()} />);
    expect(container.querySelector("h1.md-h1")?.textContent).toBe("Title");
    expect(container.querySelector("blockquote.md-quote")?.textContent).toBe("quoted");
    expect(container.querySelector("small.md-subtext")?.textContent).toBe("small");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("1");
  });

  it("renders emphasis with semantic tags", () => {
    const { container } = render(<Markdown source="**b** *i* __u__ ~~s~~" ctx={makeCtx()} />);
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
    expect(container.querySelector("u")?.textContent).toBe("u");
    expect(container.querySelector("s")?.textContent).toBe("s");
  });

  it("renders line breaks", () => {
    const { container } = render(<Markdown source={"a\nb"} ctx={makeCtx()} />);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders a timestamp as a time element", () => {
    const { container } = render(<Markdown source="<t:0:R>" ctx={makeCtx()} />);
    const time = container.querySelector("time.md-timestamp") as HTMLElement;
    expect(time.getAttribute("datetime")).toBe("1970-01-01T00:00:00.000Z");
    expect(time.textContent).toMatch(/ago$/);
    expect(time.getAttribute("title")).toBeTruthy();
  });

  it("renders nodes directly through RenderNodes", () => {
    render(<RenderNodes nodes={parse("hello **world**")} ctx={makeCtx()} />);
    expect(screen.getByText("world").tagName).toBe("STRONG");
  });

  it("renders inline previews without block wrappers", () => {
    const { container } = render(<Markdown source={"# hi\n- x"} ctx={makeCtx()} inline />);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toBe("# hi- x");
  });
});
