import { describe, expect, it } from "vitest";
import { parse, plainText } from "@/markdown";
import { applyCommand, commands, registerPluginCommand, runCommand, unregisterPluginCommand } from "./commands";

describe("applyCommand", () => {
  it("renders /shrug with both arms", () => {
    expect(plainText(parse(applyCommand("/shrug")!))).toBe("¯\\_(ツ)_/¯");
    expect(plainText(parse(applyCommand("/shrug oh well")!))).toBe("oh well ¯\\_(ツ)_/¯");
  });

  it("leaves ordinary text alone", () => {
    expect(applyCommand("hello")).toBeNull();
  });
});

describe("runCommand", () => {
  it("expands each of the six commands", () => {
    expect(runCommand("/tableflip")).toEqual({ kind: "command", text: "(╯°□°)╯︵ ┻━┻" });
    expect(runCommand("/unflip")).toEqual({ kind: "command", text: "┬─┬ ノ( ゜-゜ノ)" });
    expect(runCommand("/lenny hi")).toEqual({ kind: "command", text: "hi ( ͡° ͜ʖ ͡°)" });
    expect(runCommand("/me waves")).toEqual({ kind: "command", text: "*waves*" });
    expect(runCommand("/spoiler the end")).toEqual({ kind: "command", text: "||the end||" });
    expect(runCommand("/SHRUG").kind).toBe("command");
  });

  it("refuses /me and /spoiler with nothing after them", () => {
    expect(runCommand("/me")).toEqual({ kind: "empty", name: "me" });
    expect(runCommand("/spoiler   ")).toEqual({ kind: "empty", name: "spoiler" });
  });

  it("says when a command does not exist, rather than publishing it", () => {
    expect(runCommand("/ban alice")).toEqual({ kind: "unknown", name: "ban" });
    expect(runCommand("/giphy")).toEqual({ kind: "unknown", name: "giphy" });
  });

  it("sends paths and ordinary text as they are", () => {
    expect(runCommand("/usr/bin/env node")).toEqual({ kind: "text" });
    expect(runCommand("see /etc/hosts")).toEqual({ kind: "text" });
    expect(runCommand("hello")).toEqual({ kind: "text" });
  });
});

describe("commands from plugins", () => {
  it("are offered and run after the app's own, which they cannot replace", async () => {
    const run = async (args: string, channelId: string) => `${channelId}:${args}`;
    expect(registerPluginCommand({ name: "shrug", desc: "mine", run })).toBe(false);
    expect(registerPluginCommand({ name: "Roll", desc: "Rolls a die", run })).toBe(true);
    expect(registerPluginCommand({ name: "roll", desc: "again", run })).toBe(false);
    expect(commands().map((c) => c.name)).toContain("roll");
    const r = runCommand("/roll 2d6");
    expect(r.kind).toBe("plugin");
    if (r.kind === "plugin") expect(await r.run("c1")).toBe("c1:2d6");
    expect(runCommand("/shrug").kind).toBe("command");
    unregisterPluginCommand("roll", run);
    expect(runCommand("/roll").kind).toBe("unknown");
  });
});
