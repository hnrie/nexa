// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "@/api/types";

vi.mock("@/api/channels", () => ({
  channels: { close: () => Promise.resolve() },
}));

import { subchatMenu } from "./subchatMenu";

const sub = { id: "900", type: "subchat", name: "Plans", parent_id: "700", server_id: null, recipient_ids: [], key_conv_id: "900" } as unknown as Channel;

/** Deletes the subchat through its menu and says where, if anywhere, that went. */
async function deleteFrom(path: string): Promise<string[]> {
  const went: string[] = [];
  let confirm: (() => Promise<void>) | undefined;
  const items = subchatMenu.items({
    channel: sub,
    nav: (p) => went.push(p),
    openModal: (_kind, props) => {
      confirm = props?.["onConfirm"] as () => Promise<void>;
    },
    path,
  });
  items.find((i) => i.id === "delete")!.onSelect!();
  await confirm!();
  return went;
}

describe("deleting a subchat from its menu", () => {
  it("takes someone in it back to its conversation", async () => {
    expect(await deleteFrom("/channels/@me/900")).toEqual(["/channels/@me/700"]);
  });

  it("leaves someone elsewhere where they are", async () => {
    expect(await deleteFrom("/channels/@me/700")).toEqual([]);
    expect(await deleteFrom("/channels/@me/901")).toEqual([]);
  });
});
