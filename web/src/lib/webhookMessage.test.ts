import { describe, expect, it } from "vitest";
import {
  discordMarkdown,
  BUTTON_LINK,
  C_ACTION_ROW,
  C_BUTTON,
  C_CONTAINER,
  C_GALLERY,
  C_SECTION,
  C_TEXT,
  C_THUMBNAIL,
  hookAttachmentMeta,
  hookText,
  listedAttachments,
  mediaAttachment,
  sameHookSender,
  sanitizeHook,
} from "./webhookMessage";

// what the server stores for a remote picture: a link to its own media proxy
const proxy = (name: string) => `/media/proxy/1790000000-sig/${btoa(`https://example.com/${name}`).replace(/=+$/, "")}`;

describe("sanitizeHook", () => {
  it("reads a message with an embed the way the server sends it", () => {
    const hook = sanitizeHook({
      name: "Build Bot",
      avatar_proxy_url: proxy("bot.png"),
      avatar_url: "https://example.com/bot.png",
      content: "Build finished",
      tts: true,
      embeds: [
        {
          type: "rich",
          title: "Build #42 passed",
          url: "https://ci.example.com/42",
          description: "All **120** tests passed.",
          color: 0x57f287,
          timestamp: "2026-09-26T12:00:00.000Z",
          author: { name: "CI", url: "https://ci.example.com", proxy_icon_url: proxy("ci.png") },
          footer: { text: "main", proxy_icon_url: proxy("git.png") },
          image: { url: "https://example.com/graph.png", proxy_url: proxy("graph.png"), width: 800, height: 400 },
          thumbnail: { url: "https://example.com/t.png", proxy_url: proxy("t.png") },
          fields: [
            { name: "Branch", value: "main", inline: true },
            { name: "Took", value: "2m", inline: true },
            { name: "Notes", value: "none" },
          ],
        },
      ],
    });
    expect(hook).not.toBeNull();
    expect(hook!.name).toBe("Build Bot");
    expect(hook!.tts).toBe(true);
    expect(hook!.avatar_proxy_url).toBe(proxy("bot.png"));
    const e = hook!.embeds[0]!;
    expect(e.title).toBe("Build #42 passed");
    expect(e.url).toBe("https://ci.example.com/42");
    expect(e.color).toBe(0x57f287);
    expect(e.timestamp).toBe(Date.parse("2026-09-26T12:00:00.000Z"));
    expect(e.author).toEqual({ name: "CI", url: "https://ci.example.com", proxy_icon_url: proxy("ci.png") });
    expect(e.footer).toEqual({ text: "main", proxy_icon_url: proxy("git.png") });
    expect(e.image).toEqual({ url: "https://example.com/graph.png", proxy_url: proxy("graph.png"), width: 800, height: 400 });
    expect(e.fields).toEqual([
      { name: "Branch", value: "main", inline: true },
      { name: "Took", value: "2m", inline: true },
      { name: "Notes", value: "none", inline: false },
    ]);
  });

  it("drops links that are not web links and pictures that do not come through this server", () => {
    const hook = sanitizeHook({
      name: "x",
      avatar_url: "javascript:alert(1)",
      avatar_proxy_url: "https://evil.example/track.png",
      embeds: [
        {
          title: "t",
          url: "javascript:alert(1)",
          author: { name: "a", url: "data:text/html,hi" },
          image: { url: "https://evil.example/i.png", proxy_url: "https://evil.example/i.png" },
          thumbnail: { url: "https://example.com/ok.png", proxy_url: "//evil.example/x.png" },
          color: 0x1000000,
        },
      ],
      components: [{ type: C_ACTION_ROW, components: [{ type: C_BUTTON, style: BUTTON_LINK, label: "Go", url: "javascript:alert(1)" }] }],
    })!;
    expect(hook.avatar_url).toBeUndefined();
    expect(hook.avatar_proxy_url).toBeUndefined();
    const e = hook.embeds[0]!;
    expect(e.url).toBeUndefined();
    expect(e.author).toEqual({ name: "a" });
    expect(e.image).toBeUndefined();
    expect(e.thumbnail).toBeUndefined();
    expect(e.color).toBeUndefined();
    expect(hook.components[0]!.components[0]!.url).toBeUndefined();
  });

  it("never crashes on the wrong types, and names a message with no name", () => {
    expect(sanitizeHook(null)).toBeNull();
    expect(sanitizeHook("hello")).toBeNull();
    expect(sanitizeHook([])).toBeNull();
    const hook = sanitizeHook({ name: 5, content: {}, embeds: "no", components: [null, 3, { type: "x" }], poll: [], attachments: [{}] })!;
    expect(hook.name).toBe("Webhook");
    expect(hook.content).toBe("");
    expect(hook.embeds).toEqual([]);
    expect(hook.components).toEqual([]);
    expect(hook.poll).toBeUndefined();
    expect(hook.attachments).toEqual([]);
  });

  it("reads layout components, nested, with their media", () => {
    const hook = sanitizeHook({
      name: "x",
      components: [
        {
          type: C_CONTAINER,
          accent_color: 0x5865f2,
          spoiler: true,
          components: [
            { type: C_TEXT, content: "# Release" },
            {
              type: C_SECTION,
              components: [{ type: C_TEXT, content: "v2 is out" }],
              accessory: { type: C_THUMBNAIL, media: { url: "https://example.com/logo.png", proxy_url: proxy("logo.png") }, description: "Logo" },
            },
            {
              type: C_GALLERY,
              items: [
                { media: { url: "https://example.com/1.png", proxy_url: proxy("1.png") }, description: "One" },
                { media: { url: "https://evil.example/2.png", proxy_url: "https://evil.example/2.png" } },
                { media: { url: "attachment://a.png", blob_id: "77", attachment_id: "88" }, spoiler: true },
              ],
            },
          ],
        },
      ],
    })!;
    const box = hook.components[0]!;
    expect(box.type).toBe(C_CONTAINER);
    expect(box.accent_color).toBe(0x5865f2);
    expect(box.spoiler).toBe(true);
    expect(box.components.map((c) => c.type)).toEqual([C_TEXT, C_SECTION, C_GALLERY]);
    const section = box.components[1]!;
    expect(section.accessory?.type).toBe(C_THUMBNAIL);
    expect(section.accessory?.media?.proxy_url).toBe(proxy("logo.png"));
    expect(section.accessory?.description).toBe("Logo");
    const gallery = box.components[2]!;
    // the picture that does not come through the proxy is left out
    expect(gallery.items).toEqual([
      { media: { url: "https://example.com/1.png", proxy_url: proxy("1.png") }, description: "One" },
      { media: { url: "attachment://a.png", blob_id: "77", attachment_id: "88" }, spoiler: true },
    ]);
  });

  it("stops at a sensible depth", () => {
    let deep: Record<string, unknown> = { type: C_TEXT, content: "bottom" };
    for (let i = 0; i < 10; i++) deep = { type: C_CONTAINER, components: [deep] };
    const hook = sanitizeHook({ name: "x", components: [deep] })!;
    let depth = 0;
    let c = hook.components[0];
    while (c && c.components.length) {
      c = c.components[0];
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(5);
  });

  it("reads a poll, its answers and when it closes", () => {
    const hook = sanitizeHook({
      name: "x",
      poll: {
        question: { text: "Lunch?" },
        answers: [
          { answer_id: 1, poll_media: { text: "Pizza", emoji: { name: "🍕" } } },
          { answer_id: 2, poll_media: { text: "Soup", emoji: { id: "123", name: "soup", animated: true } } },
          { answer_id: "3", poll_media: { text: "bad id" } },
        ],
        expiry: "2026-09-27T12:00:00.000Z",
        allow_multiselect: true,
      },
    })!;
    expect(hook.poll).toEqual({
      question: "Lunch?",
      answers: [
        { answer_id: 1, text: "Pizza", emoji: { name: "🍕" } },
        { answer_id: 2, text: "Soup", emoji: { id: "123", name: "soup", animated: true } },
      ],
      expiry: Date.parse("2026-09-27T12:00:00.000Z"),
      allow_multiselect: true,
    });
    expect(sanitizeHook({ name: "x", poll: { question: { text: "?" }, answers: [] } })!.poll).toBeUndefined();
  });

  it("reads files and keeps the ones shown inline out of the list under the message", () => {
    const hook = sanitizeHook({
      name: "x",
      attachments: [
        { id: "1", blob_id: "10", filename: "log.txt", size: 12, content_type: "text/plain" },
        { id: "2", blob_id: "20", filename: "chart.png", size: 900, content_type: "image/png", width: 640, height: 480, inline: true, description: "A chart" },
        { id: "3", blob_id: "30", filename: "SPOILER_end.png", size: 5, spoiler: true, description: "the end" },
        { id: "x", blob_id: "40", filename: "bad.png", size: 1 },
      ],
    })!;
    expect(hook.attachments.map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(listedAttachments(hook)).toEqual([
      { blob_id: "10", name: "log.txt", type: "text/plain", size: 12, key: "", plain: true },
      { blob_id: "30", name: "SPOILER_end.png", type: "application/octet-stream", size: 5, key: "", plain: true, spoiler: true, alt: "the end" },
    ]);
    expect(mediaAttachment(hook, { url: "attachment://chart.png", blob_id: "20" })).toEqual({
      blob_id: "20",
      name: "chart.png",
      type: "image/png",
      size: 900,
      key: "",
      plain: true,
      w: 640,
      h: 480,
      alt: "A chart",
    });
    expect(mediaAttachment(hook, { url: "https://example.com/x.png", proxy_url: proxy("x.png") })).toBeNull();
    expect(hookAttachmentMeta(hook.attachments[0]!).plain).toBe(true);
  });
});

describe("hookText", () => {
  it("gathers every word the message says, for search and notifications", () => {
    const hook = sanitizeHook({
      name: "x",
      content: "hello",
      embeds: [{ title: "Title", description: "Body", author: { name: "Author" }, footer: { text: "Foot" }, fields: [{ name: "F", value: "V" }] }],
      components: [{ type: C_CONTAINER, components: [{ type: C_TEXT, content: "Inside" }, { type: C_SECTION, components: [{ type: C_TEXT, content: "Beside" }] }] }],
      poll: { question: { text: "Q?" }, answers: [{ answer_id: 1, poll_media: { text: "A1" } }] },
    })!;
    expect(hookText(hook).split("\n")).toEqual(["hello", "Author", "Title", "Body", "F", "V", "Foot", "Inside", "Beside", "Q?", "A1"]);
  });
});

describe("sameHookSender", () => {
  it("groups messages sent under the same name and picture", () => {
    const a = sanitizeHook({ name: "Bot", avatar_url: "https://example.com/a.png" })!;
    const b = sanitizeHook({ name: "Bot", avatar_url: "https://example.com/a.png" })!;
    const c = sanitizeHook({ name: "Bot", avatar_url: "https://example.com/b.png" })!;
    const d = sanitizeHook({ name: "Other", avatar_url: "https://example.com/a.png" })!;
    expect(sameHookSender(a, b)).toBe(true);
    expect(sameHookSender(a, c)).toBe(false);
    expect(sameHookSender(a, d)).toBe(false);
    expect(sameHookSender(a, undefined)).toBe(false);
    expect(sameHookSender(undefined, undefined)).toBe(true);
  });
});

describe("discordMarkdown", () => {
  const cases: [string, string][] = [
    // Red's help: bold closed after a line break, then a fence opened mid-line
    ["**Syntax:\n**```\n!dm <user_id> <message>\n```", "**Syntax:**\n```\n!dm <user_id> <message>\n```"],
    ["**a\nb**", "**a**\n**b**"],
    ["**a\n  b**", "**a**\n  **b**"],
    ["||spoil\ner||", "||spoil||\n||er||"],
    ["text```py\nx=1```after", "text\n```py\nx=1```\nafter"],
    ["inline ```x``` stays", "inline ```x``` stays"],
    ["**unclosed\nline", "**unclosed\nline"],
    ["`**` code\n**x**", "`**` code\n**x**"],
    ["```\n**a\nb**\n```", "```\n**a\nb**\n```"],
  ];
  it.each(cases)("rewrites %j", (src, want) => expect(discordMarkdown(src)).toBe(want));

  it("is applied to an app's content, descriptions and field values", () => {
    const h = sanitizeHook({ content: "**a\nb**", embeds: [{ description: "**S:\n**```\nx\n```", fields: [{ name: "n", value: "__u\nv__" }] }] })!;
    expect(h.content).toBe("**a**\n**b**");
    expect(h.embeds[0]!.description).toBe("**S:**\n```\nx\n```");
    expect(h.embeds[0]!.fields[0]!.value).toBe("__u__\n__v__");
  });
});
