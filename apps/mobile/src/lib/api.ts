import * as SecureStore from "expo-secure-store";

import { t } from "@suite/shared/i18n";

/**
 * The app's side of the same door the browser uses.
 *
 * Requests go to the public origin and through the Next proxy, which forwards
 * an `Authorization` header untouched — the Rust API itself is never exposed.
 * Unlike the browser, the app holds its own tokens: there is no cookie to
 * attach and nothing server-side rotating them on its behalf, so refreshing is
 * this file's job.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://business.aurovie.com";

export type Tokens = { access: string; refresh: string };

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  fields: FieldError[];

  constructor(status: number, code: string, message: string, fields: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** `{ password: "Incorrect email or password" }`, for a form to show in place. */
  get fieldMap(): Record<string, string> {
    return Object.fromEntries(this.fields.map((f) => [f.field, f.message]));
  }
}

/**
 * The keychain, not AsyncStorage: a refresh token is a thirty-day credential,
 * and AsyncStorage is a plain file readable from a backup of the device.
 */
const ACCESS_KEY = "suite.access";
const REFRESH_KEY = "suite.refresh";

let tokens: Tokens | null = null;
let onLost: (() => void) | null = null;

/** Told when a refresh is genuinely rejected, so the UI can return to sign-in. */
export function onSessionLost(fn: () => void) {
  onLost = fn;
}

export async function loadStoredTokens(): Promise<Tokens | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  tokens = access && refresh ? { access, refresh } : null;
  return tokens;
}

export async function storeTokens(next: Tokens | null) {
  tokens = next;
  if (next) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, next.access),
      SecureStore.setItemAsync(REFRESH_KEY, next.refresh),
    ]);
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  }
}

async function send(path: string, init: RequestInit, authorization: string | null) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body) headers["content-type"] = "application/json";
  if (authorization) headers.authorization = authorization;
  try {
    return await fetch(`${API_BASE}/api/${path.replace(/^\//, "")}`, { ...init, headers });
  } catch {
    // A phone loses its network mid-request as a matter of course. Saying so
    // is the difference between "try again in a moment" and a screen that
    // looks broken.
    throw new ApiError(0, "offline", t("mobile.offline"));
  }
}

/**
 * One refresh at a time, shared by everyone waiting.
 *
 * Refresh tokens rotate: spending one revokes it. A screen that fires three
 * requests on open would, on an expired access token, spend the same refresh
 * token three times — the first succeeds and the other two are rejected as
 * replays, signing the person out in the middle of their own session. So the
 * first caller starts it and the rest await the same promise.
 */
let refreshing: Promise<Tokens | null> | null = null;

function refreshOnce(): Promise<Tokens | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(): Promise<Tokens | null> {
  const spending = tokens?.refresh;
  if (!spending) return null;

  const res = await send("auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: spending }),
  }, null);

  if (res.ok) {
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    const next: Tokens = { access: body.access_token, refresh: body.refresh_token };
    await storeTokens(next);
    return next;
  }

  // Rejected, not merely unavailable: the token is spent, expired or revoked,
  // and no amount of retrying brings it back. A 5xx or a timeout is a
  // different thing entirely and must not throw the session away — that path
  // raises above rather than landing here.
  if (res.status === 401 || res.status === 403) {
    await storeTokens(null);
    onLost?.();
    return null;
  }
  throw new ApiError(res.status, "refresh_failed", t("mobile.sessionUnreachable"));
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init, tokens ? `Bearer ${tokens.access}` : null);

  if (res.status === 401 && tokens?.refresh) {
    const rotated = await refreshOnce();
    if (rotated) res = await send(path, init, `Bearer ${rotated.access}`);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeParse(text) : null;

  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "error",
      err?.message ?? `Request failed (${res.status})`,
      err?.fields ?? [],
    );
  }
  return body as T;
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Build `?a=1&b=2`, dropping empty values. Mirrors the web's client. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string } | null;
};

/** Credentials in, tokens out. The only call that runs without one. */
export async function signInRequest(email: string, password: string) {
  const res = await post<AuthResponse>("auth/login", { email: email.trim(), password });
  await storeTokens({ access: res.access_token, refresh: res.refresh_token });
  return res;
}

/** Moving the session to another business mints a new pair; it replaces this one. */
export async function switchWorkspaceRequest(organizationId: string) {
  const res = await post<AuthResponse>("auth/switch", { organization_id: organizationId });
  await storeTokens({ access: res.access_token, refresh: res.refresh_token });
  return res;
}
