import { describe, expect, it } from "vitest";
import { avatarUrl, bannerUrl, iconUrl, emojiUrl, stickerUrl } from "@/api/users";
import { useSettings } from "@/stores/settings";

describe("independent public media animation preferences", () => {
  it("requests server stills for each disabled category without freezing the others", () => {
    const original = useSettings.getState().settings;
    try {
      useSettings.setState({ settings: { ...original, animateAvatars: false, animateIcons: true, animateBanners: true, animateEmoji: true, animateStickers: true } });
      expect(avatarUrl("123", 32)).toContain("still=1");
      expect(iconUrl("123", 32)).not.toContain("still=1");
      expect(bannerUrl("123")).not.toContain("still=1");
      useSettings.setState({ settings: { ...original, animateAvatars: true, animateIcons: false, animateBanners: false, animateEmoji: false, animateStickers: false } });
      expect(avatarUrl("123", 32)).not.toContain("still=1");
      for (const url of [iconUrl("123", 32), bannerUrl("123"), emojiUrl("123", true, 32), stickerUrl("123", 32)]) expect(url).toContain("still=1");
    } finally { useSettings.setState({ settings: original }); }
  });
});
