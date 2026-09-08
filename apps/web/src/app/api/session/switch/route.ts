import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, cookieOptions, getAccessToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Move the session to another workspace.
 *
 * The organisation is baked into the access token, so this cannot be a stored
 * preference -- the server mints a new token and the cookies are replaced with
 * it. Membership is checked upstream, not here.
 */
export async function POST(req: NextRequest) {
  return reissue(req, "switch", await req.json());
}

export async function reissue(req: NextRequest, endpoint: string, body: unknown) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "api_unreachable",
          message: "Aurovie Business can't reach its own service right now. Nothing has changed — try again in a moment.",
        },
      },
      { status: 502 },
    );
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(payload ?? { error: { code: "error", message: "That did not work" } }, {
      status: upstream.status,
    });
  }

  const res = NextResponse.json({ organization: payload.organization });
  res.cookies.set(ACCESS_COOKIE, payload.access_token, cookieOptions(payload.expires_in));
  res.cookies.set(REFRESH_COOKIE, payload.refresh_token, cookieOptions(payload.refresh_expires_in));
  return res;
}
