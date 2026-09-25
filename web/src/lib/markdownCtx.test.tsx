// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import type { Channel, PublicUser, ServerView } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import { useRenderCtx } from "./markdownCtx";

const chan = (id: string, name: string): Channel => ({ id, type: "text", server_id: "s1", name, position: 0, parent_id: null, recipient_ids: [], last_message_id: null }) as unknown as Channel;
const person = (id: string, name: string, avatar: string | null = null): PublicUser => ({ id, username: id, display_name: name, avatar_id: avatar }) as unknown as PublicUser;
const server = (roleName: string, members: string[]): ServerView =>
  ({
    id: "s1",
    name: "s1",
    owner_id: "me",
    icon_id: null,
    channels: [],
    roles: [{ id: "r1", server_id: "s1", name: roleName, color: 0, position: 1, permissions: "0", mentionable: true }],
    members: members.map((user_id) => ({ server_id: "s1", user_id, role_ids: [], nickname: "", joined_at: 0 })),
    member_count: members.length,
    me: { server_id: "s1", user_id: "me", role_ids: [], nickname: "", joined_at: 0 },
    my_permissions: "0",
  }) as unknown as ServerView;

/** A row that renders markdown, counting how often it does. */
function Row({ onRender }: { onRender: (names: string) => void }) {
  const ctx = useRenderCtx();
  onRender(`${ctx.users["u1"]?.display_name}|${ctx.channels["c1"]?.name}|${ctx.roles?.["r1"]?.name}`);
  return null;
}

describe("the markdown render context", () => {
  it("does not wake the messages on screen for changes they cannot show, and does for those they can", () => {
    useChannels.getState().upsert([chan("c1", "general"), chan("c2", "busy")]);
    useUsers.getState().upsert([person("u1", "Ann")]);
    useServers.getState().setFromView(server("Helpers", ["me"]));
    const seen: string[] = [];
    render(<Row onRender={(s) => seen.push(s)} />);
    expect(seen).toEqual(["Ann|general|Helpers"]);

    // a message arriving anywhere moves a channel's last message
    act(() => useChannels.getState().setLastMessage("c2", "500"));
    // a profile fetched again with a new avatar, someone new joining a server
    act(() => useUsers.getState().upsert([person("u1", "Ann", "avatar2")]));
    act(() => useServers.getState().setFromView(server("Helpers", ["me", "u2"])));
    expect(seen).toHaveLength(1);

    // what a mention shows does change the rows
    act(() => useChannels.getState().upsert(chan("c1", "general-chat")));
    act(() => useUsers.getState().upsert([person("u1", "Annie")]));
    act(() => useServers.getState().setFromView(server("Helpers team", ["me", "u2"])));
    expect(seen).toEqual(["Ann|general|Helpers", "Ann|general-chat|Helpers", "Annie|general-chat|Helpers", "Annie|general-chat|Helpers team"]);
  });
});
