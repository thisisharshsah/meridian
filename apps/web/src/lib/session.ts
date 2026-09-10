import { cookies } from "next/headers";

export const ACCESS_COOKIE = "suite_at";
export const REFRESH_COOKIE = "suite_rt";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:7011";

/**
 * What this installation is sold as, asked of the API from the server.
 *
 * The sign-in page is the first thing a customer sees and has no session to
 * read a name out of, so it asks the one endpoint that needs no credentials.
 * A failed or slow answer falls back to the generic name rather than holding
 * the page: nobody should be unable to sign in because a label was
 * unavailable.
 */
export async function productName(fallback: string): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { product?: string };
    return body.product || fallback;
  } catch {
    return fallback;
  }
}

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
