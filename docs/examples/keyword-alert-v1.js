// An example Nexa plugin for version 1 of the API: tells you when a message
// says a word you picked, underlines mentions, and adds a /shout command. Add
// it in Settings > Plugins, from a link to this file or by pasting it in. See
// docs/plugins.md; keyword-alert.js is the same plugin for version 2.

export default {
  name: "Keyword alert",
  description: "A note when a message says the word you picked, underlined mentions, and /shout.",
  version: "1.0.0",
  author: "Nexa docs",

  // Drawn as a form on the Plugins page; the values follow your account.
  settings: [
    { key: "word", type: "text", label: "Word to watch for", default: "release" },
    { key: "mine", type: "toggle", label: "Also for my own messages", default: false },
  ],

  start(api) {
    // Everything registered here is taken away again when the plugin stops,
    // so stop() below has nothing it must clean up.
    api.css.add(".md-mention { text-decoration: underline; text-underline-offset: 2px; }");

    api.events.on("messageCreate", (message) => {
      const word = String(api.settings.get("word") || "").trim().toLowerCase();
      if (!word || !message.decrypted) return;
      if (message.mine && !api.settings.get("mine")) return;
      if (message.content.toLowerCase().includes(word)) api.toast(`Someone said "${word}".`);
    });

    api.commands.register({
      name: "shout",
      description: "Sends your message in capitals",
      run: (args) => (args.trim() ? args.toUpperCase() : null),
    });

    // Kept on this device only.
    const starts = (api.storage.get("starts") || 0) + 1;
    api.storage.set("starts", starts);
  },

  stop() {},
};
