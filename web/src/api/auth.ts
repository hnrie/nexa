import { api } from "./client";
import type { AuthResponse, KdfParamsJson, LoginResponse, RegisterRequest, Session } from "./types";

export const auth = {
  register(body: RegisterRequest): Promise<AuthResponse> {
    return api.request<AuthResponse>("POST", "/auth/register", body);
  },
  kdf(username: string): Promise<{ salt: string; params: KdfParamsJson }> {
    return api.request("GET", "/auth/kdf", undefined, { query: { username } });
  },
  login(username: string, auth_key: string): Promise<LoginResponse> {
    return api.request<LoginResponse>("POST", "/auth/login", { username, auth_key });
  },
  recoverBegin(username: string, recovery_auth_key: string): Promise<{ public_key: string; enc_private_key_recovery: string }> {
    return api.request("POST", "/auth/recover/begin", { username, recovery_auth_key });
  },
  recoverFinish(body: {
    username: string;
    recovery_auth_key: string;
    new_auth_key: string;
    new_kdf_salt: string;
    new_kdf_params: KdfParamsJson;
    new_enc_private_key: string;
    new_recovery_auth_key?: string;
    new_enc_private_key_recovery?: string;
  }): Promise<LoginResponse> {
    return api.request<LoginResponse>("POST", "/auth/recover/finish", body);
  },
  changePassword(body: {
    auth_key: string;
    new_auth_key: string;
    new_kdf_salt?: string;
    new_kdf_params?: KdfParamsJson;
    new_enc_private_key: string;
  }): Promise<void> {
    return api.request<void>("POST", "/auth/password", body);
  },
  replaceRecovery(body: { auth_key: string; recovery_auth_key: string; enc_private_key_recovery: string }): Promise<void> {
    return api.request<void>("POST", "/auth/recovery", body);
  },
  logout(): Promise<void> {
    return api.request<void>("POST", "/auth/logout");
  },
  sessions(): Promise<Session[]> {
    return api.request<Session[]>("GET", "/auth/sessions");
  },
  deleteSession(id: string): Promise<void> {
    return api.request<void>("DELETE", `/auth/sessions/${id}`);
  },
};
