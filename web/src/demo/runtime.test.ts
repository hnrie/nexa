// @vitest-environment jsdom
import { api } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { usePresence } from "@/stores/presence";
import { useUsers } from "@/stores/users";
import { installDemoRuntime } from "./runtime";
import { memoryStorage } from "./environment";

const original = { request: api.request, upload: api.upload, fetch: api.fetchImpl, xhr: api.XHRImpl };
const auth = useAuth.getState();
const users = useUsers.getState();
const presence = usePresence.getState();
afterEach(() => {
  Object.assign(api, { request: original.request, upload: original.upload, fetchImpl: original.fetch, XHRImpl: original.xhr });
  useAuth.setState(auth); useUsers.setState(users); usePresence.setState(presence); useServers.getState().clear(); useChannels.getState().clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("starts with just the visitor, without a token, people or servers", () => {
  installDemoRuntime();
  expect(useAuth.getState().token).toBeNull();
  expect(Object.values(useUsers.getState().byId).map((u) => u.display_name)).toEqual(["You"]);
  expect(Object.keys(useServers.getState().byId)).toEqual([]);
  expect(Object.keys(useChannels.getState().byId)).toEqual([]);
});

it("creates a local server and channels with real app permissions and no network", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const demo = installDemoRuntime();
  const server = await api.request<{ id: string; member_count: number; owner_id: string; channels: { id: string; type: string }[] }>("POST", "/servers", { name: "My server", defaults: { text_category: "Text", text_channel: "general", voice_category: "Voice", voice_channel: "Lounge" } });
  expect(server.owner_id).toBe(demo.me.id);
  expect(server.member_count).toBe(1);
  expect(server.channels.map((ch) => ch.type)).toEqual(["category", "text", "category", "voice"]);
  expect(useServers.getState().byId[server.id]!.myPermissions).toBeGreaterThan(0n);
  await api.request("POST", `/servers/${server.id}/channels`, { name: "ideas", type: "forum" });
  expect(Object.values(useChannels.getState().byId).some((ch) => ch.name === "ideas")).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("fails closed for people, payments, auth, uploads and unknown routes", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const prompt = vi.fn(); window.addEventListener("nexa-demo-account", prompt);
  installDemoRuntime();
  for (const [method, path] of [["POST", "/users/@me/relationships"], ["GET", "/users/search"], ["POST", "/billing/checkout"], ["POST", "/auth/register"], ["GET", "/something-new"]]) {
    await expect(api.request(method!, path!)).rejects.toMatchObject({ code: "demo_account_required" });
  }
  await expect(api.upload("/uploads", new Blob())).rejects.toMatchObject({ code: "demo_account_required" });
  expect(prompt).toHaveBeenCalledTimes(6);
  expect(fetch).not.toHaveBeenCalled();
  window.removeEventListener("nexa-demo-account", prompt);
});

it("gives each memory storage a fresh, independent lifetime", () => {
  const first = memoryStorage(); const second = memoryStorage();
  first.setItem("ec.token", "temporary");
  expect(first.getItem("ec.token")).toBe("temporary");
  expect(second.getItem("ec.token")).toBeNull();
  first.clear(); expect(first.length).toBe(0);
});
