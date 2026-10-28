// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Channel } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useReadStates } from "@/stores/readStates";
import { SubchatPanel } from "./SubchatPanel";

vi.mock("@/api/channels", () => ({ channels: { subchats: vi.fn(async () => []) } }));

const parent = { id: "700", type: "group_dm", recipient_ids: [] } as unknown as Channel;
const sub = { id: "900", type: "subchat", parent_id: "700", last_message_id: "1000", name: "Plans" } as unknown as Channel;

beforeEach(() => {
  useChannels.setState({ byId: { "700": parent, "900": sub } });
  useReadStates.setState({ byChannel: { "900": { lastReadId: "800", mentions: 0, unread: 2 } } });
});
afterEach(cleanup);

it("shows every unread message, updates live and removes the badge after reading", async () => {
  render(<MemoryRouter><SubchatPanel parent={parent} activeId={parent.id} onClose={() => undefined} /></MemoryRouter>);
  expect((await screen.findByTestId("subchat-unread")).textContent).toBe("2");
  act(() => useReadStates.getState().bumpUnread("900"));
  expect(screen.getByTestId("subchat-unread").textContent).toBe("3");
  act(() => useReadStates.getState().markRead("900", "1000"));
  expect(screen.queryByTestId("subchat-unread")).toBeNull();
  expect(screen.getByText("Plans")).toBeTruthy();
});

it("shows 99+ for large counts and counts mentions within messages once", async () => {
  useReadStates.setState({ byChannel: { "900": { lastReadId: "800", mentions: 3, unread: 100 } } });
  render(<MemoryRouter><SubchatPanel parent={parent} activeId={parent.id} onClose={() => undefined} /></MemoryRouter>);
  expect((await screen.findByTestId("subchat-unread")).textContent).toBe("99+");
  act(() => useReadStates.setState({ byChannel: { "900": { lastReadId: "800", mentions: 3, unread: 5 } } }));
  expect(screen.getByTestId("subchat-unread").textContent).toBe("5");
});
