import { auth } from "./auth";
import { one, recordRequests } from "./testing";
import type { KdfParamsJson, RegisterRequest } from "./types";

const params: KdfParamsJson = { m: 65536, t: 3, p: 1, v: 1 };

const registration: RegisterRequest = {
  username: "mara",
  display_name: "Mara",
  auth_key: "QUFB",
  kdf_salt: "QkJC",
  kdf_params: params,
  public_key: "Q0ND",
  enc_private_key: "REVG",
};

describe("auth", () => {
  it("registers with POST /auth/register", async () => {
    const calls = recordRequests();
    await auth.register(registration);
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/auth/register",
      body: registration,
    });
  });

  it("asks for the kdf record by username in the query", async () => {
    const calls = recordRequests();
    await auth.kdf("mara");
    const c = one(calls);
    expect(c.method).toBe("GET");
    expect(c.path).toBe("/auth/kdf");
    expect(c.opts?.query).toEqual({ username: "mara" });
  });

  it("logs in with the derived auth key", async () => {
    const calls = recordRequests();
    await auth.login("mara", "QUFB");
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/auth/login",
      body: { username: "mara", auth_key: "QUFB" },
    });
  });

  it("begins recovery", async () => {
    const calls = recordRequests();
    await auth.recoverBegin("mara", "UkVD");
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/auth/recover/begin",
      body: { username: "mara", recovery_auth_key: "UkVD" },
    });
  });

  it("finishes recovery", async () => {
    const calls = recordRequests();
    const body = {
      username: "mara",
      recovery_auth_key: "UkVD",
      new_auth_key: "TkVX",
      new_kdf_salt: "U0FM",
      new_kdf_params: params,
      new_enc_private_key: "S0VZ",
    };
    await auth.recoverFinish(body);
    expect(one(calls)).toMatchObject({ method: "POST", path: "/auth/recover/finish", body });
  });

  it("changes the password", async () => {
    const calls = recordRequests();
    const body = { auth_key: "T0xE", new_auth_key: "TkVX", new_enc_private_key: "S0VZ" };
    await auth.changePassword(body);
    expect(one(calls)).toMatchObject({ method: "POST", path: "/auth/password", body });
  });

  it("replaces the recovery key", async () => {
    const calls = recordRequests();
    const body = { auth_key: "T0xE", recovery_auth_key: "UkVD", enc_private_key_recovery: "S0VZ" };
    await auth.replaceRecovery(body);
    expect(one(calls)).toMatchObject({ method: "POST", path: "/auth/recovery", body });
  });

  it("logs out", async () => {
    const calls = recordRequests();
    await auth.logout();
    expect(one(calls)).toMatchObject({ method: "POST", path: "/auth/logout" });
  });

  it("lists sessions", async () => {
    const calls = recordRequests([]);
    await auth.sessions();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/auth/sessions" });
  });

  it("deletes a session by id", async () => {
    const calls = recordRequests();
    await auth.deleteSession("881");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/auth/sessions/881" });
  });
});
