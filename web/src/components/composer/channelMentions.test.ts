import { afterEach, expect, it } from "vitest";
import type { Channel } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useServers, type ServerState } from "@/stores/servers";
import { useAuth } from "@/stores/auth";
import { extractMentions } from "./mentions";
import { editNames, mentionScope } from "./send";

afterEach(() => { useChannels.getState().clear(); useServers.getState().clear(); });

it("links forum and announcement hashtags on send and after editing", () => {
  useAuth.setState({ me: { id: "1" } as never });
  useServers.setState({ byId: { "10": { server: { id: "10", owner_id: "1" }, roles: {}, members: {}, me: { user_id: "1" } } as ServerState } });
  const rows = [
    { id: "11", type: "text", name: "general" },
    { id: "12", type: "forum", name: "topics" },
    { id: "13", type: "announcement", name: "news" },
    { id: "14", type: "category", name: "category" },
  ].map((c) => ({ ...c, server_id: "10", recipient_ids: [] }) as unknown as Channel);
  useChannels.getState().upsert(rows);
  const text = "#general #topics #news #category";
  expect(extractMentions(text, {}, mentionScope("11")).text).toBe("<#11> <#12> <#13> #category");
  expect(editNames("11").channels).toEqual({ "11": "general", "12": "topics", "13": "news" });
});
