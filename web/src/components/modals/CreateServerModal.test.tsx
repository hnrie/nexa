// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordTemplatePreview } from "@/api/servers";
import type { ServerView } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useServers } from "@/stores/servers";
import { CreateServerModal } from "./CreateServerModal";

const previewDiscordTemplate = vi.fn<(code: string) => Promise<DiscordTemplatePreview>>();
const importDiscordTemplate = vi.fn<(url: string, name?: string) => Promise<ServerView>>();
const ensureConvKey = vi.fn<(conv: string) => Promise<{ epoch: number; root: Uint8Array } | null>>();

vi.mock("@/api/servers", () => ({
  servers: {
    previewDiscordTemplate: (code: string) => previewDiscordTemplate(code),
    importDiscordTemplate: (url: string, name?: string) => importDiscordTemplate(url, name),
  },
}));

afterEach(() => {
  cleanup();
  useChannels.getState().clear();
  useServers.getState().clear();
  previewDiscordTemplate.mockReset();
  importDiscordTemplate.mockReset();
  ensureConvKey.mockReset();
});

describe("CreateServerModal Discord template import", () => {
  it("previews a pasted Discord template link, lets the server name be customized, and imports it", async () => {
    useKeys.setState({ ensureConvKey } as never);
    previewDiscordTemplate.mockResolvedValue({
      code: "fVfBazbqjhXg",
      name: "Professor Oak's Classes Template",
      description: "A template for classes.",
      usage_count: 100,
      server_name: "Professor Oak's Classes",
      server_description: "",
      roles: [{ name: "Professor", color: 0x2ecc71 }],
      channels: [
        { id: 0, type: "category", name: "Information", parent_index: -1 },
        { id: 1, type: "text", name: "welcome", parent_index: 0 },
        { id: 2, type: "text", name: "staff", parent_index: 0, private: true },
      ],
    });
    importDiscordTemplate.mockResolvedValue({
      id: "srv1",
      name: "Oak Lab",
      icon_id: null,
      banner_id: null,
      owner_id: "u1",
      description: "",
      system_channel_id: "ch1",
      default_notifications: 0,
      flags: 0,
      created_at: 1,
      tag: null,
      invites_paused_until: null,
      discoverable: false,
      discovery_category: "",
      discovery_tags: [],
      discovery_language: "",
      discovery_since: null,
      discovery_hidden: false,
      verify_account_minutes: 0,
      verify_member_minutes: 0,
      automod_at: 0,
      channels: [
        { id: "cat1", server_id: "srv1", type: "category", name: "Information", topic: "", position: 0, parent_id: null, nsfw: false, slowmode_seconds: 0, user_limit: 0, owner_id: null, icon_id: null, last_message_id: null, created_at: 1, recipient_ids: [], key_conv_id: "srv1" },
        { id: "ch1", server_id: "srv1", type: "text", name: "welcome", topic: "", position: 0, parent_id: "cat1", nsfw: false, slowmode_seconds: 0, user_limit: 0, owner_id: null, icon_id: null, last_message_id: null, created_at: 1, recipient_ids: [], key_conv_id: "srv1" },
        { id: "ch2", server_id: "srv1", type: "text", name: "staff", topic: "", position: 1, parent_id: "cat1", nsfw: false, slowmode_seconds: 0, user_limit: 0, owner_id: null, icon_id: null, last_message_id: null, created_at: 1, recipient_ids: [], key_conv_id: "ch2" },
      ],
      threads: [],
      joined_threads: [],
      roles: [{ id: "srv1", server_id: "srv1", name: "@everyone", color: 0, color2: null, color3: null, hoist: false, mentionable: false, position: 0, permissions: "0", icon_id: null, icon_emoji: "", created_at: 1 }],
      members: [],
      member_count: 1,
      me: { server_id: "srv1", user_id: "u1", nickname: "", avatar_id: null, banner_id: null, bio: "", pronouns: "", joined_at: 1, timeout_until: null, flags: 0, role_ids: [] },
      my_permissions: "0",
    });
    ensureConvKey.mockResolvedValue({ epoch: 0, root: new Uint8Array(32) });

    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CreateServerModal onClose={onClose} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("open-discord-template"));
    fireEvent.change(screen.getByTestId("discord-template-url"), {
      target: { value: "https://discord.new/fVfBazbqjhXg" },
    });

    await waitFor(() => expect(screen.getByTestId("discord-template-preview")).toBeTruthy());
    expect(previewDiscordTemplate).toHaveBeenCalledWith("fVfBazbqjhXg");

    const nameInput = screen.getByTestId("discord-template-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Professor Oak's Classes");
    fireEvent.change(nameInput, { target: { value: "Oak Lab" } });

    fireEvent.click(screen.getByTestId("discord-template-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(importDiscordTemplate).toHaveBeenCalledWith("https://discord.new/fVfBazbqjhXg", "Oak Lab");
    expect(ensureConvKey).toHaveBeenCalledWith("ch2");
    expect(useServers.getState().byId["srv1"]?.server.name).toBe("Oak Lab");
  });
});
