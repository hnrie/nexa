// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel } from "@/api/types";
import { channels as channelsApi } from "@/api/channels";
import { useChannels } from "@/stores/channels";
import { usePanes } from "@/stores/panes";
import { PaneView } from "./PaneView";

vi.mock("@/components/chat/ChatView", () => ({ ChatView: ({ channel }: { channel: Channel }) => <div data-testid="chat">{channel.id}</div> }));

const ch = { id: "42", type: "dm", server_id: null, recipient_ids: ["1", "2"], name: "", last_message_id: null } as unknown as Channel;

beforeEach(() => {
  usePanes.setState({ panes: { p2: { id: "p2", serverId: null, channelId: "42" } } });
  useChannels.setState({ byId: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PaneView", () => {
  it("offers to try again when the conversation could not be fetched, instead of calling it gone", async () => {
    const get = vi.spyOn(channelsApi, "get").mockRejectedValueOnce(new ApiError(0, "network", "offline"));
    render(<PaneView paneId="p2" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/no longer here/i)).toBeNull();
    get.mockResolvedValueOnce(ch);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });
    // the fetched channel lands in the store, and the pane draws it
    await waitFor(() => expect(useChannels.getState().byId["42"]).toBeTruthy());
    expect(screen.getByTestId("chat").textContent).toBe("42");
  });

  it("says the conversation is gone when the server says so", async () => {
    vi.spyOn(channelsApi, "get").mockRejectedValueOnce(new ApiError(404, "not_found", "Not found."));
    render(<PaneView paneId="p2" />);
    await waitFor(() => expect(screen.getByText(/no longer here/i)).toBeTruthy());
  });
});
