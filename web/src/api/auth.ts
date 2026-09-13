import { api, captchaOptions } from "./client";
import type { AuthResponse, KdfParamsJson, LoginResponse, LoginResult, MfaStatus, RegisterRequest, Session, TotpSetup } from "./types";

export const auth = {
  register(body: RegisterRequest, captcha?: string | null): Promise<AuthResponse> {
    return api.request<AuthResponse>("POST", "/auth/register", body, captchaOptions(captcha));
  },
  kdf(username: string): Promise<{ salt: string; params: KdfParamsJson }> {
    return api.request("GET", "/auth/kdf", undefined, { query: { username } });
  },
  login(username: string, auth_key: string, captcha?: string | null): Promise<LoginResult> {
    return api.request<LoginResult>("POST", "/auth/login", { username, auth_key }, captchaOptions(captcha));
  },
  loginMfa(ticket: string, body: { code?: string; backup_code?: string }): Promise<LoginResponse> {
    return api.request<LoginResponse>("POST", "/auth/login/mfa", { ticket, ...body });
  },
  mfaStatus(): Promise<MfaStatus> {
    return api.request<MfaStatus>("GET", "/auth/mfa");
  },
  totpSetup(auth_key: string): Promise<TotpSetup> {
    return api.request<TotpSetup>("POST", "/auth/mfa/totp/setup", { auth_key });
  },
  totpEnable(ticket: string, code: string): Promise<{ enabled: boolean; backup_codes: string[] }> {
    return api.request("POST", "/auth/mfa/totp/enable", { ticket, code });
  },
  mfaDisable(auth_key: string): Promise<{ enabled: boolean }> {
    return api.request("POST", "/auth/mfa/disable", { auth_key });
  },
  newBackupCodes(auth_key: string): Promise<{ backup_codes: string[] }> {
    return api.request("POST", "/auth/mfa/backup", { auth_key });
  },
  recoverBegin(username: string, recovery_auth_key: string, captcha?: string | null): Promise<{ public_key: string; enc_private_key_recovery: string }> {
    return api.request("POST", "/auth/recover/begin", { username, recovery_auth_key }, captchaOptions(captcha));
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
