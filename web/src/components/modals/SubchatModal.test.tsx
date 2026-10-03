// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/channels", () => ({
  channels: {
    createSubchat: (_parent: string, name: string) => Promise.resolve({ id: "901", type: "subchat", name, parent_id: "700", server_id: null, recipient_ids: [], key_conv_id: "901" }),
  },
}));

import SubchatModal from "./SubchatModal";

afterEach(cleanup);

function open(name?: string) {
  const closed = vi.fn();
  render(
    <MemoryRouter initialEntries={["/channels/@me/700"]}>
      <Routes>
        <Route path="/channels/@me/700" element={<SubchatModal onClose={closed} parentId="700" name={name} />} />
        <Route path="/channels/@me/901" element={<p>in the new subchat</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return closed;
}

describe("the new subchat dialog", () => {
  it("starts with the name already typed in the panel", () => {
    open("Trip plans");
    expect((screen.getByTestId("subchat-modal-name") as HTMLInputElement).value).toBe("Trip plans");
  });

  it("opens the subchat it makes", async () => {
    const closed = open("Trip plans");
    await act(async () => {
      fireEvent.click(screen.getByTestId("subchat-modal-save"));
    });
    expect(closed).toHaveBeenCalled();
    expect(screen.getByText("in the new subchat")).toBeTruthy();
  });
});
