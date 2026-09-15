import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  cookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Single proxy between the clients and the Rust API, which is never exposed.
 *
 * Two kinds of caller come through it, and where the credential comes from
 * decides everything else:
 *
 * - The browser holds no token at all. Its access token lives in an httpOnly
 *   cookie, attached here, and every call is same-origin, so there is no CORS
 *   surface either. When the access token has expired this silently spends the
 *   refresh token and replays the request once.
 * - The phone app holds its own tokens and sends `Authorization` itself. That
 *   header is forwarded untouched, cookies are neither read nor written, and
 *   the app refreshes on its own — the proxy has nothing of its own to rotate.
 */
async function forward(
  req: NextRequest,
  url: URL,
  authorization: string | null,
  body: ArrayBuffer | undefined,
) {
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  if (authorization) headers.set("authorization", authorization);

  return fetch(url, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    cache: "no-store",
    redirect: "manual",
  });
}

async function refresh(refreshToken: string) {
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
  };
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Resolved before anything is judged: `new URL` collapses `..`, so the check
  // below reads the path the API will actually receive. Checking the joined
  // segments instead lets `e/..%2Fauth%2Fswitch` through as a records path.
  const url = new URL(`${API_URL}/api/${path.join("/")}`);
  url.search = req.nextUrl.search;

  const header = req.headers.get("authorization");
  const accessToken = header ? null : (req.cookies.get(ACCESS_COOKIE)?.value ?? null);
  const refreshToken = header ? null : (req.cookies.get(REFRESH_COOKIE)?.value ?? null);
  const usingCookie = Boolean(accessToken || refreshToken);

  // The cookie is never exchanged for a token a script can read. Switching and
  // creating a workspace answer with a fresh token pair in the body; forwarded
  // on the cookie's say-so, that pair would reach any script on the page — a
  // thirty-day refresh token the httpOnly cookie exists to keep out of reach.
  // The browser has `/api/session/*` for all of it, which writes tokens to
  // cookies instead, so `me` is the only auth route it needs here. An allowlist,
  // so a token-minting route added later is refused until someone decides.
  if (usingCookie && url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth/me") {
    return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }

  // Buffer the body once. A Request body is a stream that can only be read a
  // single time, and the 401 path below replays the request — reading it again
  // there would throw, losing the write and stranding the caller with a refresh
  // token that has already been rotated away.
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await forward(req, url, header ?? (accessToken && `Bearer ${accessToken}`), body);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "api_unreachable",
          message:
            "Aurovie Business can't reach its own service right now. Your data is safe — wait a moment and try again.",
        },
      },
      { status: 502 },
    );
  }

  let rotated: Awaited<ReturnType<typeof refresh>> = null;
  let refreshFailed = false;

  // Only a cookie session is refreshed here; an app's refresh token is the
  // app's. `auth/refresh` itself cannot arrive with a cookie, per the guard.
  if (upstream.status === 401 && refreshToken) {
    rotated = await refresh(refreshToken);
    if (rotated) {
      upstream = await forward(req, url, `Bearer ${rotated.access_token}`, body);
    } else {
      refreshFailed = true;
    }
  }

  const payload = await upstream.arrayBuffer();
  const res = new NextResponse(payload, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });

  if (rotated) {
    res.cookies.set(ACCESS_COOKIE, rotated.access_token, cookieOptions(rotated.expires_in));
    res.cookies.set(REFRESH_COOKIE, rotated.refresh_token, cookieOptions(rotated.refresh_expires_in));
  }
  // Clear the session only when the refresh itself failed — that is the one
  // signal that the refresh token is genuinely spent. A 401 that we never got
  // to retry (or one from a request racing a sibling that already rotated the
  // token) must not log the user out.
  if (upstream.status === 401 && refreshFailed) {
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
  }

  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
