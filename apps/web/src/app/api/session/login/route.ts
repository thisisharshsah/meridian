import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, cookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Exchanges credentials for a session. The tokens are written to httpOnly
 * cookies and never returned to the page, so scripts in the browser cannot
 * read them.
 */
export async function POST(req: NextRequest) {
  return exchange(req, "login");
}

export async function exchange(req: NextRequest, endpoint: "login" | "register") {
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await req.json()),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "api_unreachable",
          // Owner-facing. The operator instruction that used to live here named
          // a shell command, which means nothing to the person signing in.
          message:
            "Meridian can't reach its own service right now. Nothing you typed has been lost \u2014 wait a moment and try again.",
        },
      },
      { status: 502 },
    );
  }

  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(body ?? { error: { code: "error", message: "Sign in failed" } }, {
      status: upstream.status,
    });
  }

  const res = NextResponse.json({
    user: body.user,
    organization: body.organization,
  });
  res.cookies.set(ACCESS_COOKIE, body.access_token, cookieOptions(body.expires_in));
  res.cookies.set(REFRESH_COOKIE, body.refresh_token, cookieOptions(body.refresh_expires_in));
  return res;
}
