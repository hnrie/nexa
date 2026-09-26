import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@/api/types";
import { nexa as nexaApi, type NexaState } from "@/api/moderation";
import { useChannels } from "@/stores/channels";
import { useNexa } from "@/stores/nexa";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { changeDMList, closeNexa, dmArrangeItems, dmGroupMenuItems, forgetConversation, nexaListed } from "./dmArrange";
import { pinDM } from "@/lib/dmLayout";

const dm = (id: string) => ({ id, type: "dm", recipient_ids: [], last_message_id: null }) as unknown as Channel;
const ids = (items: ContextMenuItem[]) => items.map((i) => i.id);
const layout = () => useSettings.getState().settings.dmList;

beforeEach(() => {
  useChannels.setState({ byId: { "10": dm("10"), "20": dm("20"), "30": dm("30") } });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, dmList: { pins: ["10"], groups: [{ id: "gwork", name: "Work", ids: ["20"] }] } }, loaded: true, key: new Uint8Array(32) });
});

afterEach(() => {
  useSettings.getState().reset();
  useChannels.getState().clear();
  useNexa.setState({ state: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Nexa conversation", () => {
  it("is listed once Nexa has said something newer than when it was closed", () => {
    expect(nexaListed(0, 0)).toBe(false);
    expect(nexaListed(undefined, 0)).toBe(false);
    expect(nexaListed(500, 0)).toBe(true);
    expect(nexaListed(500, 500)).toBe(false);
    expect(nexaListed(501, 500)).toBe(true);
  });

  it("closes until something new: what was waiting is seen, and it leaves the pins", () => {
    const seen = vi.spyOn(nexaApi, "seen").mockResolvedValue(undefined as never);
    vi.stubGlobal("window", { location: { pathname: "/channels/@me/nexa" } });
    useNexa.setState({ state: { latest: 1234, unread: 2 } as NexaState });
    useSettings.setState((s) => ({ settings: { ...s.settings, dmList: pinDM(s.settings.dmList, "nexa") } }));
    const nav = vi.fn();
    closeNexa(nav);
    // away from it first, or opening it again would be what the page saw
    expect(nav).toHaveBeenCalledWith("/channels/@me");
    expect(seen).toHaveBeenCalled();
    expect(useSettings.getState().settings.nexaClosed).toBe(1234);
    expect(layout().pins).toEqual(["10"]);
  });
});

describe("arranging from menus", () => {
  it("offers pinning, the groups and a new one, and taking a conversation out of its group", () => {
    const items = dmArrangeItems("20");
    expect(ids(items)).toEqual(["pin", "add-to-group", "remove-from-group"]);
    expect(items[0]!.label).toBe("Pin conversation");
    const sub = items[1]!.submenu!;
    expect(ids(sub)).toEqual(["group-gwork", "new-group"]);
    expect(sub[0]!.checked).toBe(true);
    expect(items[2]!.label).toBe("Remove from Work");
    items[0]!.onSelect!();
    // pinning takes it out of its group
    expect(layout()).toEqual({ pins: ["10", "20"], groups: [{ id: "gwork", name: "Work", ids: [] }] });
  });

  it("adds the moves only for a pinned conversation", () => {
    const moves = [{ id: "move-down", label: "Move down" }];
    expect(ids(dmArrangeItems("10", moves))).toEqual(["pin", "add-to-group", "move-down"]);
    expect(ids(dmArrangeItems("30", moves))).toEqual(["pin", "add-to-group"]);
    dmArrangeItems("30")[1]!.submenu![0]!.onSelect!();
    expect(layout().groups[0]!.ids).toEqual(["20", "30"]);
  });

  it("gives a group its menu, and deleting it asks first", () => {
    const opened: { kind: string; props?: Record<string, unknown> }[] = [];
    const g = layout().groups[0]!;
    const items = dmGroupMenuItems(g, { openModal: (kind, props) => opened.push({ kind, props }), unread: false });
    expect(ids(items)).toEqual(["read", "collapse", "rename", "pin", "delete"]);
    expect(items[0]!.disabled).toBe(true);
    items[1]!.onSelect!();
    expect(layout().groups[0]!.collapsed).toBe(true);
    items.at(-1)!.onSelect!();
    expect(opened[0]!.kind).toBe("confirm");
    void (opened[0]!.props!["onConfirm"] as () => void)();
    expect(layout()).toEqual({ pins: ["10"], groups: [] });
  });

  it("drops conversations that are gone as it saves, and forgets a closed one", () => {
    useSettings.setState((s) => ({ settings: { ...s.settings, dmList: { pins: ["10", "99"], groups: [{ id: "gwork", name: "Work", ids: ["20", "98"] }] } } }));
    changeDMList((l) => pinDM(l, "30"));
    expect(layout()).toEqual({ pins: ["10", "30"], groups: [{ id: "gwork", name: "Work", ids: ["20"] }] });
    forgetConversation("20");
    expect(layout().groups[0]!.ids).toEqual([]);
  });
});
