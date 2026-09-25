import { describe, expect, it } from "vitest";
import { safeNext } from "./nextPath";

describe("safeNext", () => {
  it("keeps a path inside the app", () => {
    expect(safeNext("/channels/1/2")).toBe("/channels/1/2");
    expect(safeNext("/invite/abc?x=1#k")).toBe("/invite/abc?x=1#k");
  });

  it("refuses a protocol-relative URL, which starts with a slash too", () => {
    expect(safeNext("//evil.example")).toBe("/channels/@me");
    expect(safeNext("/\\evil.example")).toBe("/channels/@me");
  });

  it("refuses anything that is not a path", () => {
    expect(safeNext("https://evil.example")).toBe("/channels/@me");
    expect(safeNext("javascript:alert(1)")).toBe("/channels/@me");
    expect(safeNext("")).toBe("/channels/@me");
    expect(safeNext(null)).toBe("/channels/@me");
  });

  it("refuses a path a URL parser would turn into another site's address", () => {
    // tabs and line breaks are dropped and a backslash reads as a slash
    expect(safeNext("/\t/evil.example")).toBe("/channels/@me");
    expect(safeNext("/\n/evil.example")).toBe("/channels/@me");
    expect(safeNext("/\r\n/evil.example")).toBe("/channels/@me");
    expect(safeNext("/channels\\..\\x")).toBe("/channels/@me");
  });

  it("takes the fallback it is given", () => {
    expect(safeNext("//evil.example", "/somewhere")).toBe("/somewhere");
  });
});
