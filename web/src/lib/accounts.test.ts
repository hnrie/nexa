// @vitest-environment jsdom
import { forgetToken, rememberAccount, switchAccount, useAccounts } from "./accounts";
import { useAuth } from "@/stores/auth";
import type { MeUser } from "@/api/types";

const me = (id: string, name = id) => ({ id, username: id, display_name: name, avatar_id: null, flags: 0 }) as unknown as MeUser;

beforeEach(() => {
  localStorage.clear();
  useAccounts.setState({ list: [] });
  useAuth.setState({ me: null });
});

describe("accounts signed in on this browser", () => {
  it("keeps one entry per account, with its name as it is now", () => {
    rememberAccount(me("1", "Ann"), "t1");
    rememberAccount(me("2"), "t2");
    rememberAccount(me("1", "Annie"), "t1b");
    expect(useAccounts.getState().list.map((a) => [a.id, a.display_name, a.token])).toEqual([["1", "Annie", "t1b"], ["2", "2", "t2"]]);
    expect(JSON.parse(localStorage.getItem("ec.accounts") ?? "[]")).toHaveLength(2);
  });

  it("persists the current name style for the account switcher and clears a reset", () => {
    const user = { ...me("1"), name_style: { font: "comic", effect: "solid", colors: [] } };
    rememberAccount(user, "t1");
    expect(JSON.parse(localStorage.getItem("ec.accounts")!)[0].name_style).toEqual(user.name_style);
    rememberAccount({ ...user, name_style: null }, "t1");
    expect(useAccounts.getState().list[0]?.name_style).toBeNull();
  });

  it("forgets the account whose token the server refused", () => {
    rememberAccount(me("1"), "t1");
    rememberAccount(me("2"), "t2");
    forgetToken("t1");
    expect(useAccounts.getState().list.map((a) => a.id)).toEqual(["2"]);
  });

  it("switches by opening the app with the other account's token", async () => {
    rememberAccount(me("1"), "t1");
    rememberAccount(me("2"), "t2");
    useAuth.setState({ me: me("1") });
    const went: string[] = [];
    await switchAccount("2", (p) => went.push(p));
    expect(localStorage.getItem("ec.token")).toBe("t2");
    expect(went).toEqual(["/channels/@me"]);
    // not to the one already open
    await switchAccount("1", (p) => went.push(p));
    expect(went).toHaveLength(1);
  });
});
