"""A discord.py bot that exercises the bot API, for tools/bot_e2e.py.

  python dpy_bot.py BASE TOKEN GUILD_ID

It points discord.py at a Nexa server the way the developer portal tells
people to (the API, the gateway and the CDN), then does what bots do: syncs
commands, sends and edits messages with embeds and components, reacts,
manages a role and a thread, and answers the interactions the harness sets
off as a person. Each step prints one JSON line on stdout for the harness.
"""
import asyncio
import json
import os
import sys
import traceback

import discord
import yarl
from discord import app_commands

BASE, TOKEN, GUILD = sys.argv[1], sys.argv[2], int(sys.argv[3])

# the three things a bot changes to run here
discord.http.Route.BASE = BASE + "/api/v10"
discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL(BASE.replace("http", "ws", 1) + "/bot-gateway/")
discord.Asset.BASE = BASE + "/cdn"


def out(kind, **kw):
    print(json.dumps({"kind": kind, **kw}, default=str), flush=True)


intents = discord.Intents.all()
# BOT_NO_CONTENT=1: a bot without Message Content, which reads only what is sealed for it
if os.environ.get("BOT_NO_CONTENT") == "1":
    intents.message_content = False
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@tree.command(name="ping", description="Replies with pong")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message("pong")
    msg = await interaction.original_response()
    out("ping", message=msg.id, user=interaction.user.id, guild=interaction.guild_id)


@tree.command(name="echo", description="Says it back, only to you")
@app_commands.describe(text="What to say", times="How many times")
async def echo(interaction: discord.Interaction, text: str, times: app_commands.Range[int, 1, 5] = 1):
    await interaction.response.send_message(" ".join([text] * times), ephemeral=True)
    out("echo", text=text, times=times)


@tree.command(name="slow", description="Thinks first")
async def slow(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)
    await asyncio.sleep(1)
    msg = await interaction.followup.send("done slowly", wait=True)
    await interaction.edit_original_response(content="thought about it")
    out("slow", followup=msg.id)


FRUITS = ["apple", "apricot", "banana", "cherry", "grape"]


async def fruit_complete(interaction: discord.Interaction, current: str):
    return [app_commands.Choice(name=f, value=f) for f in FRUITS if f.startswith(current.lower())][:25]


@tree.command(name="fruit", description="Pick a fruit")
@app_commands.autocomplete(name=fruit_complete)
async def fruit(interaction: discord.Interaction, name: str):
    await interaction.response.send_message(f"you picked {name}")
    out("fruit", name=name)


class Form(discord.ui.Modal, title="Tell Me"):
    answer = discord.ui.TextInput(label="Your answer", placeholder="Type here", max_length=100)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.send_message(f"form said {self.answer.value}")
        out("form", value=self.answer.value)


@tree.command(name="form", description="Opens a form")
async def form(interaction: discord.Interaction):
    await interaction.response.send_modal(Form())
    out("form_opened")


@tree.context_menu(name="Inspect")
async def inspect_user(interaction: discord.Interaction, member: discord.Member):
    await interaction.response.send_message(f"that is {member.name}", ephemeral=True)
    out("inspect", target=member.id)


@tree.context_menu(name="Quote")
async def quote(interaction: discord.Interaction, message: discord.Message):
    # a message's files as a bot gets them: each must download as it was sent
    files = []
    for a in message.attachments:
        data = await a.read()
        files.append(f"{a.filename} {len(data)}/{a.size}")
    said = f"quoting: {message.content}" + (f" [files: {', '.join(files)}]" if files else "")
    await interaction.response.send_message(said)
    out("quote", target=message.id, content=message.content, files=files)


# made global after the server's commands are synced: an entry people add to their own accounts
@app_commands.context_menu(name="Peek")
@app_commands.allowed_installs(guilds=False, users=True)
@app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
async def peek(interaction: discord.Interaction, message: discord.Message):
    await quote.callback(interaction, message)


class Buttons(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Press", style=discord.ButtonStyle.primary, custom_id="press")
    async def press(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content=f"pressed by {interaction.user.name}")
        out("pressed", user=interaction.user.id)

    @discord.ui.select(placeholder="Pick one", custom_id="pick", options=[discord.SelectOption(label="Red", value="red"), discord.SelectOption(label="Blue", value="blue")])
    async def pick(self, interaction: discord.Interaction, select: discord.ui.Select):
        await interaction.response.send_message(f"picked {select.values[0]}", ephemeral=True)
        out("picked", values=select.values)


steps_done = False


@client.event
async def on_ready():
    global steps_done
    out("ready", user=client.user.name, id=client.user.id, guilds=[g.id for g in client.guilds])
    if steps_done:
        return
    steps_done = True
    try:
        await run_steps()
    except Exception as e:
        out("error", error=repr(e), trace=traceback.format_exc())


async def run_steps():
    guild = client.get_guild(GUILD)
    out("guild", name=guild.name, members=guild.member_count, channels=[c.name for c in guild.channels], roles=[r.name for r in guild.roles])
    tree.copy_global_to(guild=discord.Object(GUILD))
    synced = await tree.sync(guild=discord.Object(GUILD))
    tree.clear_commands(guild=None)
    tree.add_command(peek)
    await tree.sync()
    out("synced", names=sorted(c.name for c in synced))
    ch = discord.utils.get(guild.text_channels, name="general") or guild.text_channels[0]
    embed = discord.Embed(title="An Embed", description="Made by **discord.py**", color=0x5865F2)
    embed.add_field(name="Field", value="Value")
    embed.set_footer(text="footer")
    msg = await ch.send("hello from discord.py", embed=embed, view=Buttons())
    out("sent", message=msg.id, channel=ch.id, created=msg.created_at.isoformat())
    await msg.edit(content="hello, edited")
    await msg.add_reaction("\N{THUMBS UP SIGN}")
    fetched = await ch.fetch_message(msg.id)
    out("fetched", content=fetched.content, reactions=[str(r.emoji) for r in fetched.reactions], embeds=len(fetched.embeds), components=len(fetched.components))
    history = [m.id async for m in ch.history(limit=10)]
    out("history", count=len(history))
    role = await guild.create_role(name="Bot Made", colour=discord.Colour.green(), hoist=True)
    out("role", id=role.id, name=role.name)
    member = guild.get_member(client.user.id)
    out("me", nick=member.nick, roles=[r.name for r in member.roles])
    thread = await msg.create_thread(name="A Thread")
    await thread.send("in the thread")
    out("thread", id=thread.id, name=thread.name)
    pins_msg = await ch.send("pin me")
    await pins_msg.pin()
    pins = await ch.pins()
    out("pins", count=len(pins))
    await pins_msg.unpin()
    await pins_msg.delete()
    await voice_chat_steps(guild)
    out("steps_done")


async def voice_chat_steps(guild):
    # Use the real VoiceChannel methods without opening an audio connection.
    voice = await guild.create_voice_channel("Bot Lounge")
    assert isinstance(voice, discord.VoiceChannel)
    fetched_channel = await client.fetch_channel(voice.id)
    assert isinstance(fetched_channel, discord.VoiceChannel)
    assert guild.voice_client is None
    created = asyncio.create_task(client.wait_for(
        "message", check=lambda m: m.channel.id == voice.id and m.content == "voice chat from discord.py", timeout=15))
    await asyncio.sleep(0)
    msg = await voice.send("voice chat from discord.py", embed=discord.Embed(title="Voice Chat"))
    event = await created
    assert isinstance(event.channel, discord.VoiceChannel) and event.id == msg.id
    edited = await msg.edit(content="voice chat, edited")
    assert edited.content == "voice chat, edited"
    await msg.add_reaction("👍")
    fetched = await voice.fetch_message(msg.id)
    assert fetched.content == "voice chat, edited" and len(fetched.embeds) == 1 and fetched.reactions
    reply = await fetched.reply("voice chat reply")
    assert reply.reference.message_id == msg.id
    assert {msg.id, reply.id} <= {m.id async for m in voice.history(limit=10)}
    await msg.pin()
    assert msg.id in [m.id async for m in voice.pins()]
    await msg.unpin()
    async with voice.typing():
        pass
    deleted = asyncio.create_task(client.wait_for(
        "raw_message_delete", check=lambda p: p.message_id == reply.id, timeout=15))
    await asyncio.sleep(0)
    await reply.delete()
    await deleted
    refreshed = await client.fetch_channel(voice.id)
    assert refreshed.last_message_id is not None
    out("voice_chat", channel=voice.id, message=msg.id, type=str(voice.type))


@client.event
async def on_message(message: discord.Message):
    if message.author.id == client.user.id:
        return
    out("message", id=message.id, author=message.author.id, content=message.content, channel=message.channel.id, channel_type=str(message.channel.type), guild=message.guild.id if message.guild else None)
    if message.content == "!hello":
        await message.reply("hello back")


@client.event
async def on_member_update(before, after):
    out("member_update", id=after.id, roles=[r.name for r in after.roles])


@client.event
async def on_raw_reaction_add(payload):
    out("reaction", emoji=str(payload.emoji), user=payload.user_id)


client.run(TOKEN, log_handler=None)
