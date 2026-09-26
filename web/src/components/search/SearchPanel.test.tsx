// @vitest-environment jsdom
/**
 * The panel end to end, over a real (in-memory) index and a server that
 * answers one page per conversation.
 *
 * What this checks is the owner's complaint: the search box in a DM searches
 * that DM, and only when its chip is taken away does it search everything.
 * Nothing is loaded in the messages store: every result comes from the walk
 * the search asks for.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Message, PublicUser } from "@/api/types";
import { closeSearchIndex, openSearchIndex } from "@/search/indexer";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { SearchPanel } from "./SearchPanel";

const text = new Map<string, string>();
const files = new Map<string, { blob_id: string; name: string; type: string; size: number; key: string }[]>();
const list = vi.fn<(channelId: string, q: { before?: string; after?: string }) => Promise<Message[]>>();

vi.mock("@/api/messages", () => ({
  BULK_DELETE_MAX: 100,
  messages: { list: (id: string, q: { before?: string; after?: string }) => list(id, q) },
}));
// The real thing needs a keyring and WebCrypto; what a decryption produces is
// what matters here, not how.
vi.mock("@/lib/decrypt", () => ({
  decryptForStore: async (m: Message) => {
    const t = text.get(m.id);
    if (t === undefined) return { ...m, decryptError: "no_key" };
    const att = files.get(m.id);
    return { ...m, payload: att ? { t, att } : { t } };
  },
}));
vi.mock("@/lib/mediaCache", () => ({
  attachmentObjectURL: async () => "blob:picture",
  cachedURL: () => undefined,
  acquire: () => true,
  release: () => undefined,
}));

function msg(id: string, channel: string, body: string, author = "u2"): Message {
  text.set(id, body);
  return { id, channel_id: channel, author_id: author, type: "default", ciphertext: null, key_conv_id: "conv", key_epoch: 1, reply_to_id: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: Number(id) };
}

const user = (id: string, username: string, display: string) => ({ id, username, display_name: display, avatar_id: null }) as unknown as PublicUser;
const ch = (id: string, type: Channel["type"], extra: Partial<Channel>) => ({ id, type, name: "", server_id: null, parent_id: null, recipient_ids: [], last_message_id: null, position: 0, overwrites: [], ...extra }) as unknown as Channel;

const dm = ch("100", "dm", { recipient_ids: ["u1", "u2"], last_message_id: "20" });
const group = ch("200", "group_dm", { name: "Weekend", recipient_ids: ["u1", "u2", "u3"], last_message_id: "30" });
const general = ch("300", "text", { server_id: "900", name: "general", last_message_id: "40" });
const random = ch("301", "text", { server_id: "900", name: "random", last_message_id: "41" });

const pages: Record<string, () => Message[]> = {
  "100": () => [msg("20", "100", "plans for saturday")],
  "200": () => [msg("30", "200", "weekend plans, hiking?", "u3")],
  "300": () => [msg("40", "300", "server plans")],
  "301": () => [msg("41", "301", "more plans in random")],
};

beforeEach(async () => {
  list.mockImplementation(async (id, q) => (q.after ? [] : (pages[id]?.() ?? [])));
  useUsers.getState().upsert([user("u1", "alice", "Alice"), user("u2", "bob", "Bob"), user("u3", "carol", "Carol")]);
  useChannels.getState().upsert([dm, group, general, random]);
  useAuth.setState({ me: { id: "u1" } as never });
  useUI.setState({ connection: "open" });
  await openSearchIndex({ userId: "u1", identityPrivateKey: null, keep: false });
});

afterEach(() => {
  cleanup();
  closeSearchIndex();
  list.mockReset();
  text.clear();
  files.clear();
  useChannels.getState().clear();
});

function panel(channel: Channel, query: string) {
  return render(
    <MemoryRouter>
      <SearchPanel channel={channel} query={query} onQuery={() => {}} onClose={() => {}} />
    </MemoryRouter>,
  );
}

const results = () => screen.queryAllByTestId("search-result");

describe("SearchPanel", () => {
  it("searches only the DM it was opened in, and says so", async () => {
    panel(dm, "plans");
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 5_000 });
    expect(results()[0]!.textContent).toContain("saturday");
    expect(screen.getByTestId("search-scope").textContent).toContain("@Bob");
    // only the DM was fetched: nothing else was asked for
    expect(new Set(list.mock.calls.map((c) => c[0]))).toEqual(new Set(["100"]));
  });

  it("searches everything once the chip is taken away, and can go back", async () => {
    panel(dm, "plans");
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 5_000 });
    fireEvent.click(within(screen.getByTestId("search-scope")).getByRole("button"));
    await waitFor(() => expect(results()).toHaveLength(4), { timeout: 8_000 });
    fireEvent.click(screen.getByTestId("search-narrow"));
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 5_000 });
  });

  it("searches the server a channel is in, and no further", async () => {
    panel(general, "plans");
    await waitFor(() => expect(results()).toHaveLength(2), { timeout: 8_000 });
    expect(results().map((r) => r.textContent).join(" ")).not.toContain("saturday");
    expect(new Set(list.mock.calls.map((c) => c[0]))).toEqual(new Set(["300", "301"]));
  });

  it("counts pictures in their own tab, and shows them as a gallery", async () => {
    pages["100"] = () => {
      const m = msg("21", "100", "the sunset from last night");
      files.set("21", [{ blob_id: "b1", name: "sunset.png", type: "image/png", size: 100, key: "k" }]);
      return [m, msg("20", "100", "plans for saturday")];
    };
    panel(dm, "sunset");
    await waitFor(() => expect(screen.getByTestId("search-tab-media").textContent).toContain("1"), { timeout: 5_000 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("search-tab-media"));
    });
    await waitFor(() => expect(screen.getAllByTestId("search-media-tile")).toHaveLength(1));
    expect(screen.getByTestId("search-tab-files").textContent).toContain("0");
  });

  it("says when nothing matches, and offers to look everywhere", async () => {
    panel(dm, "zebra");
    await waitFor(() => expect(screen.getByTestId("search-nothing")).toBeTruthy(), { timeout: 5_000 });
    expect(screen.getByTestId("search-widen")).toBeTruthy();
  });
});
