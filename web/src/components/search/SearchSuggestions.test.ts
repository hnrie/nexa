import { describe, expect, it } from "vitest";
import { completeToken, partialToken } from "./SearchSuggestions";

describe("partialToken", () => {
  it("finds the filter being typed at the end", () => {
    expect(partialToken("hello from:al")).toEqual({ key: "from", value: "al", at: 6 });
    expect(partialToken("in:gen")).toEqual({ key: "in", value: "gen", at: 0 });
    expect(partialToken("before:")).toEqual({ key: "before", value: "", at: 0 });
  });

  it("ignores plain words and filters already finished with a space", () => {
    expect(partialToken("hello")).toBeNull();
    expect(partialToken("from:alice ")).toBeNull();
    expect(partialToken("wat:x")).toBeNull();
    expect(partialToken("https://example.com")).toBeNull();
  });
});

describe("completeToken", () => {
  it("fills the filter in and leaves room to keep typing", () => {
    const q = "hello from:al";
    expect(completeToken(q, partialToken(q)!, "alice")).toBe("hello from:alice ");
  });

  it("keeps whatever came after it", () => {
    const q = "from:al world";
    // the caret is inside the token, so only it is replaced
    const tok = partialToken(q, 7)!;
    expect(completeToken(q, tok, "alice")).toBe("from:alice world");
  });

  it("replaces a date rather than appending one", () => {
    const q = "before:2026-01-0";
    expect(completeToken(q, partialToken(q)!, "2026-01-31")).toBe("before:2026-01-31 ");
  });
});
