import { describe, expect, it } from "vitest";
import { isDiscordTemplateUrl, parseDiscordTemplate } from "./discordTemplate";

describe("parseDiscordTemplate", () => {
  it("parses discord.new, discord.com/template and bare codes", () => {
    expect(parseDiscordTemplate("hgM48av5Q69A")).toEqual({ ok: true, code: "hgM48av5Q69A" });
    expect(parseDiscordTemplate("  https://discord.new/6exdzMgjZgah  ")).toEqual({ ok: true, code: "6exdzMgjZgah" });
    expect(parseDiscordTemplate("discord.new/fVfBazbqjhXg?x=1#y")).toEqual({ ok: true, code: "fVfBazbqjhXg" });
    expect(parseDiscordTemplate("https://discord.com/template/2TffvPucqHkN")).toEqual({ ok: true, code: "2TffvPucqHkN" });
    expect(parseDiscordTemplate("https://discordapp.com/templates/2TffvPucqHkN/")).toEqual({ ok: true, code: "2TffvPucqHkN" });
    expect(parseDiscordTemplate("https://ptb.discord.com/template/2TffvPucqHkN")).toEqual({ ok: true, code: "2TffvPucqHkN" });
    expect(parseDiscordTemplate("https://discord.com/api/v10/guilds/templates/2TffvPucqHkN")).toEqual({ ok: true, code: "2TffvPucqHkN" });
  });

  it("distinguishes Discord invite links from template links", () => {
    expect(parseDiscordTemplate("https://discord.gg/abc123")).toEqual({ ok: false, reason: "invite" });
    expect(parseDiscordTemplate("https://discord.com/invite/abc123")).toEqual({ ok: false, reason: "invite" });
  });

  it("rejects unrelated links and empty input", () => {
    expect(parseDiscordTemplate("")).toEqual({ ok: false, reason: "empty" });
    expect(parseDiscordTemplate("https://example.com/template/2TffvPucqHkN")).toEqual({ ok: false, reason: "invalid" });
    expect(isDiscordTemplateUrl("https://discord.new/2TffvPucqHkN")).toBe(true);
    expect(isDiscordTemplateUrl("2TffvPucqHkN")).toBe(false);
  });
});
