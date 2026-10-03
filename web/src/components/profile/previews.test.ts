// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopPreview, togglePreview, usePreview } from "./previews";

const karma = { id: "138539981", name: "Karma Police", by: "Radiohead" };
const creep = { id: "138547415", name: "Creep", by: "Radiohead" };

let played: string[];
let paused: number;

beforeEach(() => {
  played = [];
  paused = 0;
  // jsdom plays nothing; these stand in, as a browser's player would answer
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    played.push(this.src);
    Object.defineProperty(this, "paused", { configurable: true, get: () => false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused++;
    Object.defineProperty(this, "paused", { configurable: true, get: () => true });
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  stopPreview("list");
  vi.restoreAllMocks();
});

describe("song previews", () => {
  it("plays one song at a time, through this server", () => {
    togglePreview(karma, "list");
    expect(usePreview.getState()).toMatchObject({ id: karma.id, owner: "list", state: "loading" });
    expect(played).toEqual([`${location.origin}/media/music/preview/${karma.id}`]);
    togglePreview(creep, "list");
    expect(usePreview.getState().id).toBe(creep.id);
    expect(played[1]).toMatch(/\/media\/music\/preview\/138547415$/);
  });

  it("pauses the song playing when it is pressed again, and plays it on after", () => {
    togglePreview(karma, "list");
    togglePreview(karma, "list");
    expect(paused).toBe(1);
    togglePreview(karma, "list");
    expect(played).toHaveLength(2);
    expect(usePreview.getState().id).toBe(karma.id);
  });

  it("is stopped only by the list that started it", () => {
    togglePreview(karma, "list");
    stopPreview("another list");
    expect(usePreview.getState().id).toBe(karma.id);
    stopPreview("list");
    expect(usePreview.getState()).toMatchObject({ id: null, owner: null, progress: 0 });
  });

  it("has nothing to play for a song added by name", () => {
    togglePreview({ name: "Our Band's Song" }, "list");
    expect(usePreview.getState().id).toBeNull();
    expect(played).toEqual([]);
  });
});
