import { describe, expect, it } from "vitest";
import { previewText } from "./moderation";

describe("previewText", () => {
  it("says what formatting says, without its marks", () => {
    expect(previewText("Hi, I **don't** understand *why*")).toBe("Hi, I don't understand why");
    expect(previewText("~~struck~~ and __underline__ and `code`")).toBe("struck and underline and code");
    expect(previewText("# A heading\n> a quote\n- a bullet\n1. a step\n-# small")).toBe("A heading a quote a bullet a step small");
    expect(previewText("see [the Terms](https://chat.evilion.xyz/terms) or <https://e.x/a>")).toBe("see the Terms or https://e.x/a");
  });

  it("keeps a code block's code on one line", () => {
    expect(previewText("```js\nconst why = 1;\nconsole.log(why);\n```\nAnd more")).toBe("const why = 1; console.log(why); And more");
  });

  it("never gives away a spoiler", () => {
    expect(previewText("the answer is ||42|| ok")).not.toContain("42");
  });

  it("leaves snake_case and lone marks alone", () => {
    expect(previewText("set some_var_name to 2 * 3")).toBe("set some_var_name to 2 * 3");
  });

  it("says a line of only files carries files", () => {
    expect(previewText("", 2)).not.toBe("");
    expect(previewText("   ", 0)).toBe("");
  });
});
