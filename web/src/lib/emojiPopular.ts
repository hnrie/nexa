import { unicodeKey } from "./emojiUsage";

/**
 * Roughly how often emoji are used everywhere, for suggesting emoji to
 * someone whose own habits are not known yet (lib/emojiSuggest.ts). In tiers,
 * after the Unicode Consortium's published emoji frequency ranking: it only
 * says which are common and which are not, so an order of magnitude is all
 * worth keeping. Anything not listed is ordinary, with no lift at all.
 */
const TIERS: readonly string[] = [
  // the most used of all
  "😂 ❤️ 🤣 👍 😭 🙏 😘 🥰 😍 😊",
  // very common
  "🎉 😁 💕 🥺 😅 🔥 ☺️ 🤦 ♥️ 🤷 🙄 😆 🤗 😉 🎂 🤔 👏 🙂 😳 🥳 😎 👌 💜 😔 💪 ✨ 💖 👀 😋 😏 😢 👉 💗 😩 💯 🌹 💞 🎈 💙 😃 💔 😡 😄 🙌 😀 💀",
  // common
  "💐 😜 🙈 🤞 🤤 🤪 ❣️ 💋 👇 😌 💓 🤩 🙃 😬 😱 😴 🤭 😐 🌞 😒 😇 🌸 😈 🎶 ✌️ 🎊 🥵 😞 💚 ☀️ 🖤 💰 😚 👑 🎁 💥 🙋 ☹️ 😑 🥴 👈 💩 ✅ 👋 🤮 😤 🤢 🌟 ❗ 😥 🌈 💛 😝 😫 😲 ‼️ 🌻 🤯 💃 👊 🤬 😕 ⚡ ☕ 🍀 💦 ⭐ 🦋 🤨 🌺 😹 🤘 🌷 💝 💤 🤝 😓 💘 🍻 😟 😣 🧐 😠 🤠 😻 🌙 😛 🤙 🙊 🧡 🤍 😶 🫶 🥹 🫠 🤡 👻 💫 😮 🥲 😪 🤓 👎 😖 🫡 🤌 🍕 🎵 👆 🤟 💨 🎄 💎 🥂 🍷 🍺 💅 🙇 🤑 🥶 😷",
];

/** How far each tier lifts an emoji among others that match as well. */
const LIFTS = [14, 10, 6];

const byKey = new Map<string, number>();
TIERS.forEach((tier, i) => {
  for (const e of tier.split(" ")) if (e && !byKey.has(unicodeKey(e))) byKey.set(unicodeKey(e), LIFTS[i]!);
});

/** How much an emoji's everyday popularity lifts it; 0 for one that is not especially common. */
export function popularity(unicode: string): number {
  return byKey.get(unicodeKey(unicode)) ?? 0;
}
