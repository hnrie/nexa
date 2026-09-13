import { describe, expect, it } from "vitest";
import { parse, plainText } from "@/markdown";
import { applyCommand } from "./commands";

describe("applyCommand", () => {
  it("renders /shrug with both arms", () => {
    expect(plainText(parse(applyCommand("/shrug")!))).toBe("¯\\_(ツ)_/¯");
    expect(plainText(parse(applyCommand("/shrug oh well")!))).toBe("oh well ¯\\_(ツ)_/¯");
  });

  it("leaves ordinary text alone", () => {
    expect(applyCommand("hello")).toBeNull();
  });
});
