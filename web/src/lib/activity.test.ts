import type { Activity } from "@/api/types";
import { activityLine, activityParts, activityProgress, formatClock, activityHeading, activityDestination } from "./activity";

const song: Activity = { name: "Music Player", type: 2, details: "Never Gonna Give You Up", state: "Rick Astley", created_at: 0, timestamps: { start: 1_000_000, end: 1_213_000 } };

describe("activity text", () => {
  it("says what kind of thing it is, the way Discord does", () => {
    expect(activityLine({ ...song, status_display_type: undefined })).toBe("Listening to Music Player");
    expect(activityLine({ name: "Rocket League", type: 0, created_at: 0 })).toBe("Playing Rocket League");
    expect(activityLine({ name: "YouTube", type: 3, created_at: 0 })).toBe("Watching YouTube");
    expect(activityLine({ name: "Arena", type: 5, created_at: 0 })).toBe("Competing in Arena");
  });

  it("uses the state or details instead of the name when the activity asks", () => {
    expect(activityLine({ ...song, status_display_type: 1 })).toBe("Listening to Rick Astley");
    expect(activityLine({ ...song, status_display_type: 2 })).toBe("Listening to Never Gonna Give You Up");
    // falls back to the name when that text is missing
    expect(activityLine({ name: "Game", type: 0, status_display_type: 2, created_at: 0 })).toBe("Playing Game");
  });

  it("names the artists of a Spotify song, not the app", () => {
    const spotify: Activity = { ...song, name: "Spotify", state: "Rick Astley, Stock Aitken Waterman", source: "discord" };
    expect(activityLine(spotify)).toBe("Listening to Rick Astley, Stock Aitken Waterman");
    expect(activityParts({ ...spotify, name: "spotify" }).name).toBe("Rick Astley, Stock Aitken Waterman");
    // what the program asks for still wins, and a song without artists keeps the app's name
    expect(activityLine({ ...spotify, status_display_type: 0 })).toBe("Listening to Spotify");
    expect(activityLine({ ...spotify, status_display_type: 2 })).toBe("Listening to Never Gonna Give You Up");
    expect(activityLine({ ...spotify, state: undefined })).toBe("Listening to Spotify");
    // another player keeps its own name unless it asks
    expect(activityParts(song).name).toBe("Music Player");
  });

  it("heads the card with the kind and the app", () => {
    expect(activityHeading(song)).toBe("Listening to Music Player");
    expect(activityHeading({ name: "Game", type: 0, created_at: 0 })).toBe("Playing a game");
  });
});

describe("activity time", () => {
  it("draws a progress bar for music and video with a start and an end", () => {
    expect(activityProgress(song, 1_060_000)).toEqual({ kind: "progress", elapsed: 60_000, total: 213_000, fraction: 60_000 / 213_000 });
  });

  it("holds the bar at its ends outside the song", () => {
    expect(activityProgress(song, 900_000)).toEqual({ kind: "progress", elapsed: 0, total: 213_000, fraction: 0 });
    expect(activityProgress(song, 2_000_000)).toEqual({ kind: "progress", elapsed: 213_000, total: 213_000, fraction: 1 });
  });

  it("counts up from a start alone, and for games even with an end", () => {
    expect(activityProgress({ name: "Game", type: 0, created_at: 0, timestamps: { start: 1_000 } }, 61_000)).toEqual({ kind: "elapsed", elapsed: 60_000 });
    expect(activityProgress({ name: "Game", type: 0, created_at: 0, timestamps: { start: 1_000, end: 99_000 } }, 61_000)).toEqual({ kind: "elapsed", elapsed: 60_000 });
  });

  it("counts down to an end alone", () => {
    expect(activityProgress({ name: "Game", type: 0, created_at: 0, timestamps: { end: 100_000 } }, 40_000)).toEqual({ kind: "remaining", remaining: 60_000 });
  });

  it("has nothing to show without timestamps", () => {
    expect(activityProgress({ name: "Game", type: 0, created_at: 0 }, 5)).toBeNull();
  });

  it("formats clocks like a player", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(61_999)).toBe("1:01");
    expect(formatClock(3_600_000 + 5_000)).toBe("1:00:05");
  });
});


it("canonicalizes activity destinations and refuses non-web schemes or credentials", () => {
  for (const raw of ["javascript:alert(1)", "intent://example.com", "file:///private", "https://nexa.fish@evil.example/", "not a url"]) expect(activityDestination(raw)).toBeNull();
  expect(activityDestination("https://EVIL.example:8443/account")).toEqual({ href: "https://evil.example:8443/account", host: "evil.example:8443" });
});
