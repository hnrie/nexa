import { channels } from "@/api/channels";
import type { Channel } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { dmBulkMenu } from "./dmBulk";

const ch = (id: string, type: Channel["type"]) => ({ id, type, recipient_ids: [] }) as unknown as Channel;

beforeEach(() => {
  vi.stubGlobal("window", { location: { pathname: "/channels/@me" } });
  vi.spyOn(channels, "close").mockResolvedValue(undefined);
  useChannels.setState({ byId: { "1": ch("1", "group_dm"), "2": ch("2", "dm"), "3": ch("3", "group_dm") } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("asks once for mixed selections and applies silent=%s to every group", async (silent) => {
  const openModal = vi.fn();
  dmBulkMenu.items({ ids: ["1", "2", "3"], nav: vi.fn(), openModal }).find((i) => i.id === "close")!.onSelect!();
  expect(openModal).toHaveBeenCalledTimes(1);
  const [kind, props] = openModal.mock.calls[0]!;
  expect(kind).toBe("confirm");
  expect(props.checkboxLabel).toBeTruthy();
  await props.onConfirm(silent);
  expect(channels.close).toHaveBeenNthCalledWith(1, "1", silent);
  expect(channels.close).toHaveBeenNthCalledWith(2, "2", false);
  expect(channels.close).toHaveBeenNthCalledWith(3, "3", silent);
});

it("closes a selection without groups without asking", async () => {
  const openModal = vi.fn();
  dmBulkMenu.items({ ids: ["2"], nav: vi.fn(), openModal }).find((i) => i.id === "close")!.onSelect!();
  expect(openModal).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(channels.close).toHaveBeenCalledWith("2", false));
});
