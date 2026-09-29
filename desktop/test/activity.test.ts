import { describe, expect, it } from "vitest";
import { normalizeActivity } from "../src/main/rpc/activity";

const now = 1_800_000_000_000;

describe("normalizeActivity", () => {
  it("keeps a music activity with its playback bar", () => {
    const a = normalizeActivity(
      "123456789012345678",
      {
        type: 2,
        details: "Never Gonna Give You Up",
        state: "Rick Astley",
        timestamps: { start: 1_799_999_990, end: 1_800_000_203 },
        assets: { large_image: "album", large_text: "Whenever You Need Somebody" },
        buttons: [{ label: "Listen", url: "https://example.com/song" }],
        status_display_type: 2,
        instance: false,
      },
      now,
    );
    expect(a).toEqual({
      application_id: "123456789012345678",
      type: 2,
      details: "Never Gonna Give You Up",
      state: "Rick Astley",
      timestamps: { start: 1_799_999_990_000, end: 1_800_000_203_000 },
      assets: { large_image: "album", large_text: "Whenever You Need Somebody" },
      buttons: [{ label: "Listen", url: "https://example.com/song" }],
      status_display_type: 2,
    });
  });

  it("cleans what does not fit Discord's rules", () => {
    const a = normalizeActivity(
      "123456789012345678",
      {
        type: 4,
        details: "x".repeat(300),
        state: "a\nb",
        details_url: "javascript:alert(1)",
        timestamps: { start: now, end: now - 5 },
        party: { id: "p1", size: [3, 2] },
        buttons: [
          { label: "", url: "https://ok.example" },
          { label: "Second", url: "https://two.example" },
          { label: "Third", url: "https://three.example" },
        ],
        instance: true,
      },
      now,
    )!;
    expect(a.type).toBe(0);
    expect(a.details!.length).toBe(128);
    expect(a.state).toBe("a b");
    expect(a.details_url).toBeUndefined();
    expect(a.timestamps).toEqual({ start: now });
    expect(a.party).toEqual({ id: "p1" });
    expect(a.buttons).toEqual([{ label: "Second", url: "https://two.example/" }]);
    expect(a.instance).toBe(true);
  });

  it("treats a missing activity as clearing it, and a nonsense one as nothing", () => {
    expect(normalizeActivity("123456789012345678", null, now)).toBeNull();
    expect(normalizeActivity("123456789012345678", "nope", now)).toBeNull();
    expect(normalizeActivity("123456789012345678", [], now)).toBeNull();
  });
});
