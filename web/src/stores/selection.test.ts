import { beforeEach, describe, expect, it } from "vitest";
import { rangeBetween, useSelection } from "./selection";

const picked = () => Object.keys(useSelection.getState().picked).sort();

describe("picking messages", () => {
  beforeEach(() => useSelection.getState().clear());

  it("starts in one channel with the message it was started from", () => {
    useSelection.getState().start("c1", "5");
    expect(useSelection.getState().channelId).toBe("c1");
    expect(picked()).toEqual(["5"]);
    expect(useSelection.getState().anchor).toBe("5");
  });

  it("starts empty when that message cannot be picked", () => {
    useSelection.getState().start("c1");
    expect(useSelection.getState().channelId).toBe("c1");
    expect(picked()).toEqual([]);
  });

  it("toggles, and a toggle moves where a range starts", () => {
    const sel = useSelection.getState();
    sel.start("c1", "5");
    sel.toggle("7");
    expect(picked()).toEqual(["5", "7"]);
    expect(useSelection.getState().anchor).toBe("7");
    useSelection.getState().toggle("5");
    expect(picked()).toEqual(["7"]);
    expect(useSelection.getState().anchor).toBe("5");
  });

  it("adds a whole range without dropping what was picked", () => {
    const sel = useSelection.getState();
    sel.start("c1", "1");
    sel.addRange(["3", "4", "5"], "5");
    expect(picked()).toEqual(["1", "3", "4", "5"]);
    expect(useSelection.getState().anchor).toBe("5");
  });

  it("forgets messages that are gone", () => {
    const sel = useSelection.getState();
    sel.start("c1", "1");
    sel.toggle("2");
    sel.toggle("3");
    useSelection.getState().drop(["1", "3", "9"]);
    expect(picked()).toEqual(["2"]);
  });

  it("starting in another channel starts over", () => {
    useSelection.getState().start("c1", "1");
    useSelection.getState().start("c2", "8");
    expect(useSelection.getState().channelId).toBe("c2");
    expect(picked()).toEqual(["8"]);
  });

  it("clears", () => {
    useSelection.getState().start("c1", "1");
    useSelection.getState().clear();
    expect(useSelection.getState().channelId).toBeNull();
    expect(picked()).toEqual([]);
    expect(useSelection.getState().anchor).toBeNull();
  });
});

describe("rangeBetween", () => {
  const order = ["1", "2", "3", "4", "5"];
  it("runs from one message to the other in list order, either way round", () => {
    expect(rangeBetween(order, "2", "4")).toEqual(["2", "3", "4"]);
    expect(rangeBetween(order, "4", "2")).toEqual(["2", "3", "4"]);
    expect(rangeBetween(order, "3", "3")).toEqual(["3"]);
  });
  it("is just the target when the start is no longer loaded", () => {
    expect(rangeBetween(order, "9", "2")).toEqual(["2"]);
  });
});
