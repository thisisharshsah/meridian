import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  cookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Single proxy between the browser and the Rust API.
 *
 * It exists so the access token can live in an httpOnly cookie: the browser
 * never holds a bearer token, and every call is same-origin, so there is no
 * CORS surface either. When the access token has expired it silently spends the
 * refresh token and replays the request once.
 */
async function forward(req: NextRequest, path: string[], accessToken: string | null) {
  const url = new URL(`${API_URL}/api/${path.join("/")}`);
  url.search = req.nextUrl.search;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  return fetch(url, {
    method: req.method,
    headers,
    body: hasBody && body && body.byteLength > 0 ? body : undefined,
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
  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? null;

  let upstream: Response;
  try {
    upstream = await forward(req, path, accessToken);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "api_unreachable",
          message:
            "The API server is not responding. Start it with `cargo run` in the server directory.",
        },
      },
      { status: 502 },
    );
  }

  let rotated: Awaited<ReturnType<typeof refresh>> = null;

  if (upstream.status === 401 && refreshToken && path.join("/") !== "auth/refresh") {
    rotated = await refresh(refreshToken);
    if (rotated) {
      upstream = await forward(req, path, rotated.access_token);
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
  // A refresh token that no longer works should not keep being retried.
  if (upstream.status === 401 && !rotated && refreshToken) {
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
