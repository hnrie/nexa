// An example Nexa plugin: tells you when a message says a word you picked,
// underlines mentions, and adds a /shout command. Add it in Settings >
// Plugins, from a link to this file or by pasting it in. See docs/plugins.md.

export default {
  name: "Keyword alert",
  description: "A note when a message says the word you picked, underlined mentions, and /shout.",
  version: "2.0.0",
  author: "Nexa docs",
  apiVersion: 2,

  // Written out plainly, so the app can show them before any of this code runs.
  permissions: [
    "users.self.read",
    "servers.channels.read",
    "servers.messages.read",
    "servers.messages.write",
    "directmessages.read",
    "directmessages.write",
    "events.read",
    "commands.write",
    "styles.write",
    "storage.read",
    "storage.write",
    "ui.write",
  ],

  // Drawn as a form on the Plugins page; the values follow your account.
  settings: [
    { key: "word", type: "text", label: "Word to watch for", default: "release" },
    { key: "mine", type: "toggle", label: "Also for my own messages", default: false },
  ],

  start(api) {
    // Everything registered here is taken away again when the plugin stops,
    // so there is no stop() to write.
    api.styles.add(".md-mention { text-decoration: underline; text-underline-offset: 2px; }");

    const me = api.users.me;
    api.events.on("messageCreated", (message) => {
      const word = String(api.settings.get("word") || "").trim().toLowerCase();
      if (!word || message.content === null) return;
      if (message.authorId === me.id && !api.settings.get("mine")) return;
      if (message.content.toLowerCase().includes(word)) {
        api.ui.toast(`Someone said "${word}".`, { type: "warning", duration: 6000 });
      }
    });

    // A command sends nothing by itself; it sends what it wants to.
    api.commands.register("shout", "Sends your message in capitals", (args, ctx) => {
      if (args.trim() && ctx.channel) api.messages.send(ctx.channel.id, { content: args.toUpperCase() });
    });

    // Kept on this device only.
    const starts = (api.storage.get("starts") ?? 0) + 1;
    api.storage.set("starts", starts);
  },
};
