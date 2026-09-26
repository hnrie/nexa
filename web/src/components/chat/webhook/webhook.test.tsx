// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { freshName } from "@/components/server/pages/IntegrationsPage";
import { sanitizeHook, type HookEmbed, type HookEmbedField } from "@/lib/webhookMessage";
import { HookComponents } from "./HookComponents";
import { percents, timeLeft } from "./HookPoll";
import { RichEmbeds, fieldRows, mergeGalleries } from "./RichEmbeds";

afterEach(cleanup);

const proxy = (name: string) => `/media/proxy/1790000000-sig/${btoa(`https://example.com/${name}`).replace(/=+$/, "")}`;
const pic = (name: string) => ({ url: `https://example.com/${name}`, proxy_url: proxy(name) });

describe("mergeGalleries", () => {
  it("shows embeds that share a link as one, with up to four of their pictures", () => {
    const e = (url: string | undefined, image: string): HookEmbed => ({ type: "rich", fields: [], image: pic(image), ...(url ? { url } : {}) });
    const shown = mergeGalleries([e("https://a", "1"), e("https://a", "2"), e("https://b", "3"), e("https://a", "4"), e("https://a", "5"), e("https://a", "6"), e(undefined, "7"), e(undefined, "8")]);
    expect(shown.map((x) => x.images.map((m) => m.url.slice(-1)).join(""))).toEqual(["1245", "3", "7", "8"]);
  });
});

describe("fieldRows", () => {
  const f = (name: string, inline: boolean): HookEmbedField => ({ name, value: name, inline });
  it("puts up to three inline fields in a row, and any other field on a row of its own", () => {
    const rows = fieldRows([f("a", true), f("b", true), f("c", true), f("d", true), f("e", false), f("g", true)], false);
    expect(rows.map((r) => `${r.field.name} ${r.column}`)).toEqual(["a 1 / 5", "b 5 / 9", "c 9 / 13", "d 1 / 13", "e 1 / 13", "g 1 / 13"]);
  });
  it("puts two to a row beside a thumbnail", () => {
    const rows = fieldRows([f("a", true), f("b", true), f("c", true)], true);
    expect(rows.map((r) => `${r.field.name} ${r.column}`)).toEqual(["a 1 / 7", "b 7 / 13", "c 1 / 13"]);
  });
});

describe("timeLeft", () => {
  const now = 1_790_000_000_000;
  it("says how long a poll has left in its largest whole unit", () => {
    expect(timeLeft(now + 30_000, now)).toBe("Ends soon");
    expect(timeLeft(now + 61_000, now)).toBe("1 minute left");
    expect(timeLeft(now + 45 * 60_000, now)).toBe("45 minutes left");
    expect(timeLeft(now + 3 * 3_600_000 + 5, now)).toBe("3 hours left");
    expect(timeLeft(now + 49 * 3_600_000, now)).toBe("2 days left");
  });
});

describe("percents", () => {
  it("gives each answer its whole share of the votes", () => {
    const tally = { answer_counts: [{ id: 1, count: 1, me_voted: false }, { id: 2, count: 1, me_voted: true }, { id: 3, count: 2, me_voted: false }], total_voters: 3, expires_at: null, is_finalized: false };
    expect([...percents(tally)]).toEqual([[1, 25], [2, 25], [3, 50]]);
    expect([...percents({ ...tally, answer_counts: [{ id: 1, count: 0, me_voted: false }] })]).toEqual([[1, 0]]);
    expect(percents(undefined).size).toBe(0);
  });
});

describe("freshName", () => {
  it("names a new webhook something none of the others is called", () => {
    expect(freshName("Webhook", [])).toBe("Webhook");
    expect(freshName("Webhook", ["webhook", "Webhook 2"])).toBe("Webhook 3");
  });
});

describe("RichEmbeds", () => {
  it("draws an embed's title as a link that opens in a new tab, with its text, fields and footer", () => {
    const hook = sanitizeHook({
      name: "CI",
      embeds: [
        {
          title: "Build passed",
          url: "https://ci.example.com/42",
          description: "All **tests** passed",
          color: 0x57f287,
          fields: [{ name: "Branch", value: "main", inline: true }],
          footer: { text: "nexa/main" },
          author: { name: "Runner" },
        },
      ],
    })!;
    render(<RichEmbeds hook={hook} />);
    const link = screen.getByRole("link", { name: "Build passed" });
    expect(link.getAttribute("href")).toBe("https://ci.example.com/42");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("tests").tagName).toBe("STRONG");
    expect(screen.getByText("Branch")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("nexa/main")).toBeTruthy();
    expect(screen.getByText("Runner")).toBeTruthy();
    const card = screen.getByTestId("rich-embed");
    expect(card.style.borderInlineStartColor).toBe("#57f287");
  });

  it("leaves a title that was sent with a bad link as plain text", () => {
    render(<RichEmbeds hook={sanitizeHook({ name: "x", embeds: [{ title: "Click", url: "javascript:alert(1)" }] })!} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Click")).toBeTruthy();
  });
});

describe("HookComponents", () => {
  it("draws link buttons that open their page in a new tab, and a disabled one that goes nowhere", () => {
    const hook = sanitizeHook({
      name: "x",
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Open Dashboard", url: "https://dash.example.com/a" },
            { type: 2, style: 5, label: "Old", url: "https://dash.example.com/b", disabled: true },
            { type: 2, style: 1, label: "Needs an app", custom_id: "x" },
          ],
        },
      ],
    })!;
    render(<HookComponents hook={hook} v2={false} from="x" />);
    const buttons = screen.getAllByTestId("webhook-link-button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("href")).toBe("https://dash.example.com/a");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Open Dashboard, opens dash.example.com");
    expect(buttons[0]!.getAttribute("rel")).toContain("noopener");
    expect(buttons[1]!.getAttribute("href")).toBeNull();
    expect(buttons[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Needs an app")).toBeNull();
  });

  it("lays out text in boxes and sections, and keeps a spoiler box covered until it is opened", () => {
    const hook = sanitizeHook({
      name: "x",
      components: [
        { type: 10, content: "## Weekly Report" },
        { type: 14, divider: true, spacing: 2 },
        { type: 17, spoiler: true, accent_color: 0xff0000, components: [{ type: 9, components: [{ type: 10, content: "Secret numbers" }], accessory: { type: 2, style: 5, label: "More", url: "https://example.com/more" } }] },
      ],
    })!;
    const { container } = render(<HookComponents hook={hook} v2 from="x" />);
    expect(screen.getByRole("heading", { name: "Weekly Report" })).toBeTruthy();
    expect(container.querySelector("hr")?.getAttribute("data-spacing")).toBe("2");
    const cover = screen.getByRole("button", { name: "Spoiler, select to show" });
    expect(container.querySelector("[data-hidden=true]")).not.toBeNull();
    fireEvent.click(cover);
    expect(container.querySelector("[data-hidden=true]")).toBeNull();
    expect(screen.getByText("Secret numbers")).toBeTruthy();
    expect(screen.getByTestId("webhook-link-button").getAttribute("href")).toBe("https://example.com/more");
  });
});
