// A discord.js bot that exercises the bot API, for tools/bot_e2e.py: the
// same steps and answers as dpy_bot.py, printed as JSON lines.
//
//   node djs_bot.js BASE TOKEN GUILD_ID
const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder,
  ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags,
} = require("discord.js");

const [BASE, TOKEN, GUILD] = process.argv.slice(2);
const out = (kind, data = {}) => console.log(JSON.stringify({ kind, ...data }));

// the two things a discord.js bot changes to run here: the API and the CDN
const client = new Client({
  intents: Object.values(GatewayIntentBits).filter((v) => typeof v === "number"),
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  rest: { api: `${BASE}/api`, cdn: `${BASE}/cdn` },
});

const FRUITS = ["apple", "apricot", "banana", "cherry", "grape"];

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Replies with pong"),
  new SlashCommandBuilder().setName("echo").setDescription("Says it back, only to you")
    .addStringOption((o) => o.setName("text").setDescription("What to say").setRequired(true))
    .addIntegerOption((o) => o.setName("times").setDescription("How many times").setMinValue(1).setMaxValue(5)),
  new SlashCommandBuilder().setName("slow").setDescription("Thinks first"),
  new SlashCommandBuilder().setName("fruit").setDescription("Pick a fruit")
    .addStringOption((o) => o.setName("name").setDescription("The fruit").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("form").setDescription("Opens a form"),
  new ContextMenuCommandBuilder().setName("Inspect").setType(ApplicationCommandType.User),
  new ContextMenuCommandBuilder().setName("Quote").setType(ApplicationCommandType.Message),
].map((c) => c.toJSON());

let started = false;

client.once(Events.ClientReady, async (c) => {
  out("ready", { user: c.user.username, id: c.user.id, guilds: [...c.guilds.cache.keys()] });
  if (started) return;
  started = true;
  try {
    await steps();
  } catch (e) {
    out("error", { error: String(e), trace: e.stack });
  }
});

async function steps() {
  const guild = await client.guilds.fetch(GUILD);
  const channels = await guild.channels.fetch();
  const roles = await guild.roles.fetch();
  out("guild", { name: guild.name, members: guild.memberCount, channels: [...channels.values()].map((c) => c.name), roles: [...roles.values()].map((r) => r.name) });
  const synced = await guild.commands.set(commands);
  out("synced", { names: [...synced.values()].map((c) => c.name).sort() });
  const ch = [...channels.values()].find((c) => c.name === "general");
  const embed = new EmbedBuilder().setTitle("An Embed").setDescription("Made by **discord.js**").setColor(0x5865f2).addFields({ name: "Field", value: "Value" }).setFooter({ text: "footer" });
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("press").setLabel("Press").setStyle(ButtonStyle.Primary));
  const row2 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("pick").setPlaceholder("Pick one").addOptions({ label: "Red", value: "red" }, { label: "Blue", value: "blue" }));
  const msg = await ch.send({ content: "hello from discord.js", embeds: [embed], components: [row1, row2] });
  out("sent", { message: msg.id, channel: ch.id, created: msg.createdAt.toISOString() });
  await msg.edit({ content: "hello, edited" });
  await msg.react("\u{1F44D}");
  const fetched = await ch.messages.fetch({ message: msg.id, force: true });
  out("fetched", { content: fetched.content, reactions: [...fetched.reactions.cache.keys()], embeds: fetched.embeds.length, components: fetched.components.length });
  const history = await ch.messages.fetch({ limit: 10 });
  out("history", { count: history.size });
  const role = await guild.roles.create({ name: "Bot Made", colors: { primaryColor: 0x57f287 }, hoist: true });
  out("role", { id: role.id, name: role.name });
  const me = await guild.members.fetchMe();
  out("me", { nick: me.nickname, roles: [...me.roles.cache.values()].map((r) => r.name) });
  const thread = await msg.startThread({ name: "A Thread" });
  await thread.send("in the thread");
  out("thread", { id: thread.id, name: thread.name });
  const pin = await ch.send("pin me");
  await pin.pin();
  const pins = await ch.messages.fetchPins();
  out("pins", { count: pins.items.length });
  await pin.unpin();
  await pin.delete();
  out("steps_done");
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isAutocomplete()) {
      const typed = i.options.getFocused().toLowerCase();
      await i.respond(FRUITS.filter((f) => f.startsWith(typed)).map((f) => ({ name: f, value: f })));
      return;
    }
    if (i.isChatInputCommand()) {
      switch (i.commandName) {
        case "ping": {
          await i.reply("pong");
          const msg = await i.fetchReply();
          out("ping", { message: msg.id, user: i.user.id, guild: i.guildId });
          return;
        }
        case "echo": {
          const text = i.options.getString("text", true);
          const times = i.options.getInteger("times") ?? 1;
          await i.reply({ content: Array(times).fill(text).join(" "), flags: MessageFlags.Ephemeral });
          out("echo", { text, times });
          return;
        }
        case "slow": {
          await i.deferReply();
          await new Promise((r) => setTimeout(r, 1000));
          const f = await i.followUp("done slowly");
          await i.editReply("thought about it");
          out("slow", { followup: f.id });
          return;
        }
        case "fruit":
          await i.reply(`you picked ${i.options.getString("name", true)}`);
          out("fruit", { name: i.options.getString("name", true) });
          return;
        case "form": {
          const modal = new ModalBuilder().setCustomId("tell").setTitle("Tell Me").addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("answer").setLabel("Your answer").setStyle(TextInputStyle.Short).setMaxLength(100)),
          );
          await i.showModal(modal);
          out("form_opened");
          return;
        }
      }
    }
    if (i.isUserContextMenuCommand()) {
      await i.reply({ content: `that is ${i.targetUser.username}`, flags: MessageFlags.Ephemeral });
      out("inspect", { target: i.targetUser.id });
      return;
    }
    if (i.isMessageContextMenuCommand()) {
      await i.reply(`quoting: ${i.targetMessage.content}`);
      out("quote", { target: i.targetMessage.id, content: i.targetMessage.content });
      return;
    }
    if (i.isModalSubmit()) {
      const value = i.fields.getTextInputValue("answer");
      await i.reply(`form said ${value}`);
      out("form", { value });
      return;
    }
    if (i.isButton()) {
      await i.update({ content: `pressed by ${i.user.username}` });
      out("pressed", { user: i.user.id });
      return;
    }
    if (i.isStringSelectMenu()) {
      await i.reply({ content: `picked ${i.values[0]}`, flags: MessageFlags.Ephemeral });
      out("picked", { values: i.values });
    }
  } catch (e) {
    out("error", { error: String(e), trace: e.stack });
  }
});

client.on(Events.MessageCreate, (m) => {
  if (m.author.id === client.user.id) return;
  out("message", { id: m.id, author: m.author.id, content: m.content, guild: m.guildId });
});

client.on(Events.MessageReactionAdd, (r, u) => out("reaction", { emoji: r.emoji.name, user: u.id }));

client.login(TOKEN);
