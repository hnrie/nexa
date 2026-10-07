// A Nexa plugin that touches every part of version 1 of the API. Version 1
// plugins ask for no permissions and have full access; write new ones for
// version 2 (try-everything.js). See docs/plugins.md.
//
// To try it: a message with "hello" in it shows a toast, and /try-shout hi
// sends "HI" as your message.

export default {
  name: "Try Everything v1",
  description: "Tries the version 1 plugin API.",
  version: "1.0.0",
  author: "Nexa docs",
  settings: [
    { key: "word", type: "text", label: "Word to watch for", default: "hello" },
  ],

  start(api) {
    api.toast(`Running for ${api.me ? api.me.displayName : "nobody"} on build ${api.app.build}`, "success");

    // A green line beside every message.
    api.css.add("[data-row] { box-shadow: inset 2px 0 0 #3ba55d; }");

    api.events.on("messageCreate", (m) => {
      const word = api.settings.get("word");
      if (word && m.decrypted && m.content.toLowerCase().includes(String(word).toLowerCase())) api.toast(`Saw "${word}" in a message`);
    });

    // In version 1, what run returns is sent in the command's place.
    api.commands.register({ name: "try-shout", description: "Sends your words in capitals", run: (args) => args.toUpperCase() });

    const runs = (api.storage.get("runs") || 0) + 1;
    api.storage.set("runs", runs);
    api.toast(`Started ${runs} time(s) on this device`);

    api.settings.onChange((v) => api.toast(`Now watching for "${v.word}"`));
  },
};
