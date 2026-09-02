import { cookies } from "next/headers";

export const ACCESS_COOKIE = "suite_at";
export const REFRESH_COOKIE = "suite_rt";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8787";

/** Tokens live in httpOnly cookies, so page scripts (and any XSS) cannot read them. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function getAccessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken() {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}
