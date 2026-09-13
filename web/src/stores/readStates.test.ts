import { beforeEach, describe, expect, it } from "vitest";
import { api, ApiError } from "@/api/client";
import type { Channel } from "@/api/types";
import { useChannels } from "./channels";
import { useReadStates } from "./readStates";

const ch = (id: string): Channel => ({
  id,
  server_id: null,
  type: "text",
  name: "c" + id,
  topic: "",
  position: 0,
  parent_id: null,
  nsfw: false,
  slowmode_seconds: 0,
  user_limit: 0,
  owner_id: null,
  icon_id: null,
  last_message_id: "50",
  created_at: 0,
  recipient_ids: [],
  key_conv_id: id,
});

let acks: string[] = [];
let fail: unknown = null;

beforeEach(() => {
  acks = [];
  fail = null;
  api.request = <T>(method: string, path: string): Promise<T> => {
    acks.push(`${method} ${path}`);
    return fail ? Promise.reject(fail) : Promise.resolve({} as T);
  };
  useReadStates.getState().clear();
  useChannels.getState().clear();
  useChannels.getState().upsert([ch("7")]);
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const ready = (lastRead: string) => useReadStates.getState().setMany([{ channel_id: "7", last_read_message_id: lastRead, last_ack_at: 0, mention_count: 2 }]);

describe("read states", () => {
  it("sends a failed ack again on the next ready and keeps the channel read", async () => {
    fail = new TypeError("Failed to fetch");
    await useReadStates.getState().ack("7", "50");
    expect(useReadStates.getState().byChannel["7"]).toEqual({ lastReadId: "50", mentions: 0 });

    fail = null;
    ready("10");
    expect(useReadStates.getState().byChannel["7"]).toEqual({ lastReadId: "50", mentions: 0 });
    await flush();
    expect(acks).toEqual(["POST /channels/7/messages/50/ack", "POST /channels/7/messages/50/ack"]);

    // once it went through, a later ready is taken as it is
    ready("10");
    expect(useReadStates.getState().byChannel["7"]).toEqual({ lastReadId: "10", mentions: 2 });
    expect(acks).toHaveLength(2);
  });

  it("does not retry an ack the server refused", async () => {
    fail = new ApiError(403, "missing_access", "No.");
    await useReadStates.getState().ack("7", "50");
    fail = null;
    ready("10");
    expect(useReadStates.getState().byChannel["7"]).toEqual({ lastReadId: "10", mentions: 2 });
    expect(acks).toHaveLength(1);
  });

  it("lets a state set on purpose win over a failed ack", async () => {
    fail = new TypeError("Failed to fetch");
    await useReadStates.getState().ack("7", "50");
    useReadStates.getState().set({ channel_id: "7", last_read_message_id: "20", last_ack_at: 0, mention_count: 0 });
    fail = null;
    ready("20");
    expect(useReadStates.getState().byChannel["7"]!.lastReadId).toBe("20");
    expect(acks).toHaveLength(1);
  });
});
