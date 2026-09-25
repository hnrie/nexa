import { describe, expect, it } from "vitest";
import { compareIds, ID_EPOCH, idAt, idTime } from "./ids";

describe("idAt", () => {
  it("is the first id of its moment, so a time sorts among ids", () => {
    const at = ID_EPOCH + 86_400_000;
    expect(idTime(idAt(at))).toBe(at);
    // any id made in that moment is at least this one, and one made a moment later is past it
    const made = ((BigInt(at - ID_EPOCH) << 22n) | 0x3fffffn).toString();
    expect(compareIds(made, idAt(at))).toBe(1);
    expect(compareIds(idAt(at + 1), made)).toBe(1);
  });

  it("puts anything before the epoch first", () => {
    expect(idAt(0)).toBe("0");
    expect(idAt(ID_EPOCH)).toBe("0");
    expect(idAt(Number.NaN)).toBe("0");
  });
});
