import { describe, expect, it } from "vitest";
import type { AppCommand } from "@/api/apps";
import { commandLeaves, localized, nestOptions, protocolLocale } from "./apps";

const cmd = (options: AppCommand["options"]): AppCommand => ({ id: "1", application_id: "2", version: "3", type: 1, name: "config", description: "Settings", options, default_member_permissions: null });

describe("command leaves", () => {
  it("is the command itself when it has no subcommands", () => {
    const leaves = commandLeaves(cmd([{ type: 3, name: "text", description: "What", required: true }]));
    expect(leaves.map((l) => [l.label, l.path])).toEqual([["config", []]]);
    expect(leaves[0]!.options.map((o) => o.name)).toEqual(["text"]);
  });

  it("is each subcommand, and each subcommand of a group, by its full name", () => {
    const leaves = commandLeaves(
      cmd([
        { type: 1, name: "show", description: "Shows them", options: [] },
        { type: 2, name: "role", description: "Roles", options: [{ type: 1, name: "add", description: "Adds one", options: [{ type: 8, name: "role", description: "Which", required: true }] }] },
      ]),
    );
    expect(leaves.map((l) => l.label)).toEqual(["config show", "config role add"]);
    expect(leaves[1]!.path).toEqual(["role", "add"]);
    expect(leaves[1]!.options[0]!.name).toEqual("role");
  });
});

describe("options as the server takes them", () => {
  it("nests values under the subcommand path", () => {
    expect(nestOptions(["role", "add"], [{ name: "role", value: "9" }])).toEqual([{ name: "role", options: [{ name: "add", options: [{ name: "role", value: "9" }] }] }]);
  });

  it("marks the option being typed into", () => {
    expect(nestOptions([], [{ name: "fruit", value: "ap", focused: true }])).toEqual([{ name: "fruit", value: "ap", focused: true }]);
  });
});

describe("languages", () => {
  it("names Nexa's languages as bot libraries do", () => {
    expect(protocolLocale("en")).toBe("en-US");
    expect(protocolLocale("es")).toBe("es-ES");
    expect(protocolLocale("sv")).toBe("sv-SE");
    expect(protocolLocale("pt-BR")).toBe("pt-BR");
  });

  it("uses a name in the reader's language where the app gave one", () => {
    expect(localized("ping", { de: "pingen" }, "de")).toBe("pingen");
    expect(localized("ping", { "en-GB": "ping, mate" }, "en")).toBe("ping, mate");
    expect(localized("ping", { fr: "pinguer" }, "de")).toBe("ping");
    expect(localized("ping", undefined, "de")).toBe("ping");
  });
});
