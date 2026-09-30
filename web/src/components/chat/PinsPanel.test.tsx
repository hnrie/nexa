// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PublicUser } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { PinsPanel } from "./PinsPanel";

const long = Array.from({ length: 12 }, (_, i) => `line ${i + 1} of a long pinned message`).join("\n");

function pinned(id: string, text: string): DecryptedMessage {
  return {
    id,
    channel_id: "c",
    author_id: "bob",
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 1,
    edited_at: null,
    created_at: Date.UTC(2026, 8, 20, 15, 4),
    payload: { v: 1, t: text },
  } as DecryptedMessage;
}

vi.mock("@/api/channels", () => ({ channels: { pins: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]), unpin: vi.fn(async () => undefined) } }));
vi.mock("@/lib/decrypt", () => ({ decryptForStore: vi.fn(async (m: { id: string }) => pinned(m.id, m.id === "p1" ? long : "a **short** one")) }));

beforeEach(() => {
  useAuth.setState({ me: { id: "me", display_name: "Me", flags: 0 } as never });
  useChannels.setState({ byId: { c: { id: "c", type: "dm", recipient_ids: ["me", "bob"] } as unknown as Channel } });
  useUsers.setState({ byId: { bob: { id: "bob", username: "bob", display_name: "Bob", avatar_id: null, flags: 0 } as unknown as PublicUser } });
  useUI.setState({ jumpTo: null });
});
afterEach(cleanup);

describe("PinsPanel", () => {
  it("draws each pin as its message: who, when, and every line of it", async () => {
    render(
      <MemoryRouter>
        <PinsPanel channelId="c" onClose={() => undefined} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId("pinned-message")).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("pinned-message");
    expect(first!.textContent).toContain("Bob");
    expect(first!.textContent).toContain("line 12 of a long pinned message");
    // formatted the way the conversation formats it
    expect(second!.querySelector("strong")?.textContent).toBe("short");
    expect(first!.querySelector("time")).toBeTruthy();
  });

  it("goes to the message on Jump, and closes", async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <PinsPanel channelId="c" onClose={onClose} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId("pin-jump")).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId("pin-jump")[1]!);
    expect(useUI.getState().jumpTo).toEqual({ channelId: "c", messageId: "p2" });
    expect(onClose).toHaveBeenCalled();
  });
});
