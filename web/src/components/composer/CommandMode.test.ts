import { describe, expect, it } from "vitest";
import type { CommandOption } from "@/api/apps";
import { slotProblem, slotValue, type Slot } from "./CommandMode";

const slot = (opt: Partial<CommandOption> & Pick<CommandOption, "type">, text = "", more: Partial<Slot> = {}): Slot => ({ opt: { name: "x", description: "", ...opt }, text, ...more });

describe("a command's option slots", () => {
  it("need what is required, and nothing that is not", () => {
    expect(slotProblem(slot({ type: 3, required: true }))).toBeTruthy();
    expect(slotProblem(slot({ type: 3 }))).toBeUndefined();
    expect(slotProblem(slot({ type: 3, required: true }, "hi"))).toBeUndefined();
  });

  it("hold numbers to their kind and range", () => {
    expect(slotProblem(slot({ type: 4 }, "1.5"))).toBeTruthy();
    expect(slotProblem(slot({ type: 4, min_value: 1, max_value: 5 }, "9"))).toBeTruthy();
    expect(slotProblem(slot({ type: 4, min_value: 1, max_value: 5 }, "3"))).toBeUndefined();
    expect(slotProblem(slot({ type: 10 }, "abc"))).toBeTruthy();
    expect(slotValue(slot({ type: 10 }, "2.5"))).toBe(2.5);
  });

  it("hold words to their length", () => {
    expect(slotProblem(slot({ type: 3, min_length: 3 }, "ab"))).toBeTruthy();
    expect(slotProblem(slot({ type: 3, max_length: 3 }, "abcd"))).toBeTruthy();
  });

  it("take a choice, a person or a file only when one was picked", () => {
    expect(slotProblem(slot({ type: 3, choices: [{ name: "A", value: "a" }] }, "a"))).toBeTruthy();
    expect(slotProblem(slot({ type: 3, choices: [{ name: "A", value: "a" }] }, "", { value: "a" }))).toBeUndefined();
    expect(slotProblem(slot({ type: 6 }, "bob"))).toBeTruthy();
    expect(slotValue(slot({ type: 6 }, "", { value: "42" }))).toBe("42");
    expect(slotProblem(slot({ type: 11 }))).toBeTruthy();
    expect(slotValue(slot({ type: 11 }, "", { file: { id: "7", filename: "a.png", size: 1, content_type: "image/png" } }))).toBe("7");
  });
});
