import { keys } from "./keys";
import { relationships } from "./relationships";
import { one, recordRequests } from "./testing";
import { unfurl } from "./unfurl";

describe("relationships", () => {
  it("lists, requests, accepts, removes, blocks and unblocks", async () => {
    let calls = recordRequests([]);
    await relationships.list();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/@me/relationships" });
    calls = recordRequests();
    await relationships.request("bob");
    expect(one(calls)).toMatchObject({ method: "POST", path: "/users/@me/relationships", body: { username: "bob" } });
    calls = recordRequests();
    await relationships.accept("9");
    expect(one(calls)).toMatchObject({ method: "PUT", path: "/users/@me/relationships/9" });
    calls = recordRequests();
    await relationships.remove("9");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/users/@me/relationships/9" });
    calls = recordRequests();
    await relationships.block("9");
    expect(one(calls)).toMatchObject({ method: "PUT", path: "/users/@me/blocks/9" });
    calls = recordRequests();
    await relationships.unblock("9");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/users/@me/blocks/9" });
  });
});

describe("keys", () => {
  it("covers the key endpoints", async () => {
    let calls = recordRequests([]);
    await keys.grants();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/keys/grants" });
    calls = recordRequests([]);
    await keys.needs();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/keys/needs" });
    calls = recordRequests({ inserted: 1 });
    const grant = { conv_id: "5", epoch: 0, user_id: "9", wrapped_key: "QUFB" };
    await keys.putGrants([grant]);
    expect(one(calls)).toMatchObject({ method: "POST", path: "/keys/grants", body: [grant] });
    calls = recordRequests({ conv_id: "5", epoch: 1, user_ids: [] });
    await keys.createEpoch("5", "kick");
    expect(one(calls)).toMatchObject({ method: "POST", path: "/keys/epochs", body: { conv_id: "5", reason: "kick" } });
    calls = recordRequests({ epochs: [], flags: {}, entitled: [] });
    await keys.epochs("5");
    const c = one(calls);
    expect(c.path).toBe("/keys/epochs");
    expect(c.opts?.query).toEqual({ conv_id: "5" });
  });
});

describe("unfurl", () => {
  it("passes the url as a query and maps 204 to null", async () => {
    let calls = recordRequests({ url: "https://a.b", type: "link", title: "t" });
    await expect(unfurl.fetch("https://a.b")).resolves.toMatchObject({ type: "link" });
    expect(one(calls).opts?.query).toEqual({ url: "https://a.b" });
    calls = recordRequests(undefined);
    await expect(unfurl.fetch("https://a.b")).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
