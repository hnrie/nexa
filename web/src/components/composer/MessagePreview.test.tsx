// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUsers } from "@/stores/users";
import { MessagePreview } from "./MessagePreview";

afterEach(cleanup);

describe("the message preview", () => {
  it("draws the message as sending will make it, under the writer's name, and nothing for an empty box", () => {
    useAuth.setState({ me: { id: "100", username: "ada", display_name: "Ada", avatar_id: null, flags: 0 } as never });
    useChannels.setState({ byId: { c1: { id: "c1", type: "dm", server_id: null, recipient_ids: ["100", "101"], name: "" } as never } });
    useUsers.setState({ byId: { "101": { id: "101", username: "bob", display_name: "Bob", avatar_id: null, flags: 0 } as never } });
    const { rerender } = render(<MessagePreview text="**hi** @Bob" channelId="c1" onClose={() => {}} />);
    const preview = screen.getByTestId("message-preview");
    expect(preview.querySelector("strong")?.textContent).toBe("hi");
    // a typed @name is the mention it will be
    expect(preview.querySelector(".md-mention")?.textContent).toBe("@Bob");
    expect(preview.textContent).toContain("Ada");
    expect(preview.textContent).toContain("Only you can see this preview");
    rerender(<MessagePreview text="   " channelId="c1" onClose={() => {}} />);
    expect(screen.queryByTestId("message-preview")).toBeNull();
  });
});
