import { beforeEach, describe, expect, it, vi } from "vitest";

const inChannel = vi.fn();
vi.mock("@/api/apps", () => ({ apps: { inChannel: (id: string) => inChannel(id) } }));

const { useAppCommands, channelCommands } = await import("./appCommands");

const list = (n: number) => ({ applications: [], commands: [], n }) as never;

describe("appCommands", () => {
  beforeEach(() => {
    inChannel.mockReset();
    useAppCommands.setState({ byChannel: {} });
  });

  it("keeps a stale list in use and reloads the open channel's when commands change", async () => {
    inChannel.mockResolvedValueOnce(list(1));
    await useAppCommands.getState().load("a");
    expect(channelCommands("a")).toEqual(list(1));

    inChannel.mockResolvedValueOnce(list(2));
    useAppCommands.getState().forget();
    // the old list stays until the new one is in
    expect(channelCommands("a")).toEqual(list(1));
    expect(inChannel).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(channelCommands("a")).toEqual(list(2)));
  });

  it("reads a stale list again when it is next asked for", async () => {
    inChannel.mockResolvedValue(list(1));
    await useAppCommands.getState().load("a");
    await useAppCommands.getState().load("b");
    useAppCommands.getState().forget();
    await vi.waitFor(() => expect(inChannel).toHaveBeenCalledTimes(3)); // b, the open one, again
    await useAppCommands.getState().load("a");
    expect(inChannel).toHaveBeenCalledTimes(4);
    await useAppCommands.getState().load("a");
    expect(inChannel).toHaveBeenCalledTimes(4);
  });
});
