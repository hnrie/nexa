// @vitest-environment jsdom
/**
 * The panel end to end, with a server that answers one page.
 *
 * What this is really checking is that a message nobody has opened — no page of
 * it loaded, nothing in the messages store — still turns up in the results,
 * which is the whole point of the walk behind the panel.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Channel, Message } from "@/api/types";
import { clearSearchIndex } from "@/lib/fullSearch";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { SearchPanel } from "./SearchPanel";

const text = new Map<string, string>();
const list = vi.fn<(channelId: string, q: { before?: string; after?: string }) => Promise<Message[]>>();

vi.mock("@/api/messages", () => ({
  BULK_DELETE_MAX: 100,
  messages: { list: (id: string, q: { before?: string }) => list(id, q) },
}));
// The real thing needs a keyring and WebCrypto; what a decryption produces is
// what matters here, not how.
vi.mock("@/lib/decrypt", () => ({
  decryptForStore: async (m: Message) => {
    const t = text.get(m.id);
    return t === undefined ? { ...m, decryptError: "no_key" } : { ...m, payload: { t } };
  },
}));

function msg(id: string, channel: string, body: string): Message {
  text.set(id, body);
  return {
    id,
    channel_id: channel,
    author_id: "u1",
    type: "default",
    ciphertext: null,
    key_conv_id: "conv",
    key_epoch: 1,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: Number(id),
  };
}

const channel = (id: string, name: string, last: string): Channel =>
  ({ id, server_id: "s1", type: "text", name, recipient_ids: [], last_message_id: last, overwrites: [] }) as unknown as Channel;

afterEach(() => {
  cleanup();
  clearSearchIndex();
  list.mockReset();
  text.clear();
  useChannels.getState().clear();
  useMessages.getState().clearAll();
});

describe("SearchPanel", () => {
  it("finds a message in a conversation nobody has opened", async () => {
    const here = channel("c1", "general", "10");
    const elsewhere = channel("c2", "archive", "20");
    useChannels.getState().upsert([here, elsewhere]);
    useAuth.setState({ me: { id: "u1" } as never });
    list.mockImplementation(async (id) => (id === "c2" ? [msg("20", "c2", "the needle, buried")] : [msg("10", "c1", "hay")]));

    render(
      <MemoryRouter>
        <SearchPanel channel={here} query="needle" onQuery={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );

    const hit = await screen.findByText("needle", { selector: "mark", exact: false }, { timeout: 5_000 });
    expect(hit).toBeTruthy();
    expect(screen.getByTestId("search-panel").querySelectorAll("[data-result]")).toHaveLength(1);
    // Both conversations were walked, not only the one on screen. The hit
    // appears as soon as the newest conversation gives it up, which is before
    // the rest of the walk has run, so this waits for the walk rather than
    // asserting on whatever it had reached when the first result rendered.
    await waitFor(() => expect([...new Set(list.mock.calls.map((c) => c[0]))].sort()).toEqual(["c1", "c2"]), { timeout: 5_000 });
  });

  it("walks only the channel an in: filter names", async () => {
    const here = channel("c1", "general", "10");
    useChannels.getState().upsert([here, channel("c2", "archive", "20")]);
    useAuth.setState({ me: { id: "u1" } as never });
    list.mockImplementation(async (id) => (id === "c2" ? [msg("20", "c2", "the needle, buried")] : [msg("10", "c1", "needle")]));

    render(
      <MemoryRouter>
        <SearchPanel channel={here} query="needle in:archive" onQuery={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByText("needle", { selector: "mark", exact: false }, { timeout: 5_000 });
    expect(list.mock.calls.map((c) => c[0])).toEqual(["c2"]);
  });

  it("stops the walk when the button says so", async () => {
    useChannels.getState().upsert([channel("c1", "general", "10")]);
    useAuth.setState({ me: { id: "u1" } as never });
    // A conversation that never runs out of pages, so the walk is still going
    // when the button is pressed.
    let next = 100_000;
    list.mockImplementation(async () => Array.from({ length: 100 }, () => msg(String(next--), "c1", "needle")));

    render(
      <MemoryRouter>
        <SearchPanel channel={channel("c1", "general", "10")} query="needle" onQuery={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );

    const cancel = await screen.findByTestId("search-cancel", undefined, { timeout: 5_000 });
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.getByTestId("search-again")).toBeTruthy());
    const pages = list.mock.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(list.mock.calls.length).toBe(pages);
  });
});
