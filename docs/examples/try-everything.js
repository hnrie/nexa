// A Nexa plugin that touches most of version 2 of the API, to see each part
// work. It sends nothing and changes nothing on its own: everything it does
// shows up as toasts, styling and menu buttons. See docs/plugins.md.
//
// To try it: a message with "hello" in it shows a toast; /try-where shows
// where you typed it; right-click a message for "Quote in a Toast" and
// "Copy Link (Renamed)"; set keys for Highlight Messages in Settings,
// Keybinds and press them.

export default {
  name: "Try Everything",
  description: "Tries most of the plugin API.",
  version: "2.0.0",
  author: "Nexa docs",
  apiVersion: 2,
  permissions: [
    "users.self.read",
    "servers.read",
    "servers.channels.read",
    "servers.messages.read",
    "directmessages.read",
    "events.read",
    "events.write",
    "commands.write",
    "keybinds.read",
    "keybinds.write",
    "styles.write",
    "storage.read",
    "storage.write",
    "ui.write",
  ],
  settings: [
    { key: "word", type: "text", label: "Word to watch for", default: "hello" },
    { key: "loud", type: "toggle", label: "Show a warning instead of a note", default: false },
  ],

  start(api) {
    const me = api.users.me;
    api.ui.toast(`Running for ${me.displayName}, in ${api.servers.list().length} server(s)`, { type: "success" });

    // A toast when a message has the word in it, in servers and direct messages.
    // Switch off Read Server Messages on the Plugins page and it stops at once,
    // in servers only.
    api.events.on("messageCreated", (m) => {
      const word = api.settings.get("word");
      if (m.content && word && m.content.toLowerCase().includes(word.toLowerCase())) {
        api.ui.toast(`Saw "${word}" in a message`, { type: api.settings.get("loud") ? "warning" : "info" });
      }
    });
    api.events.on("typingStarted", (e) => console.log("someone started typing in", e.channelId));
    api.events.on("typingStopped", (e) => console.log("someone stopped typing in", e.channelId));
    api.settings.onChange("word", (now, before) => api.ui.toast(`Watching for "${now}" now, not "${before}"`, { duration: 2000 }));

    // A custom event, heard here (and by any other plugin) as "Try Everything:ping".
    api.events.on("Try Everything:ping", (d) => api.ui.toast(`Heard its own ping: ${d.n}`, { duration: 1500 }));
    api.events.run("ping", { n: 1 });

    // /try-where says where you ran it, and sends nothing.
    api.commands.register("try-where", "Says where you are", (args, ctx) => {
      api.ui.toast(`/try-where in #${ctx.channel ? ctx.channel.name : "?"} with "${args}"`);
    });

    // A keybind, unbound until you set its keys in Settings, Keybinds.
    let highlighted = null;
    api.keybinds.register("highlight", { name: "Highlight Messages", description: "Turns a yellow line beside messages on and off" }, () => {
      if (highlighted) {
        highlighted();
        highlighted = null;
      } else {
        highlighted = api.styles.add("[data-row] { box-shadow: inset 2px 0 0 #fdb833; }");
      }
    });
    api.keybinds.onChange("highlight", (keys) => api.ui.toast(keys ? `Highlight is on ${keys}` : "Highlight has no keys"));

    // A button of its own in the message menu, with a Lucide icon, after Reply.
    api.ui.contextMenu.add("message", {
      id: "tryEverythingQuote",
      label: "Quote in a Toast",
      icon: "quote",
      after: "replyToMessage",
      onClick: (ctx) => api.ui.toast(ctx.message && ctx.message.content ? `"${ctx.message.content.slice(0, 80)}"` : "Can't read that one"),
    });
    // Renames one of the app's buttons; it gets its name back when the plugin stops.
    api.ui.contextMenu.edit("copyMessageLink", { label: "Copy Link (Renamed)" });

    // Counts its starts, on this device.
    const runs = (api.storage.get("runs") ?? 0) + 1;
    api.storage.set("runs", runs);

    // Asks something with the app's own dialog, the first time it starts on this device.
    if (runs === 1) {
      setTimeout(async () => {
        const yes = await api.ui.confirm({ title: "A Long Toast", message: "This is the plugin's first start here. Show a 15 second toast?", confirmText: "Show It", cancelText: "No" });
        if (yes) api.ui.toast("A long toast", { type: "warning", duration: 15000 });
      }, 1500);
    }
  },
};
