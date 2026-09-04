import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "suite_at";
const REFRESH_COOKIE = "suite_rt";

const PUBLIC_PATHS = ["/login", "/register"];
/// Reachable whether or not you are signed in: an existing user can be invited
/// into another workspace, so this must not bounce them home.
const ALWAYS_PATHS = ["/invite"];

/**
 * Route guard. This is a redirect for ergonomics only - the Rust API is what
 * actually enforces access, and it re-checks every request.
 */
export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Cloudflare terminates TLS and reports the client's scheme here. A page
  // served over plain http:// looks fine right up until sign-in: the session
  // cookies are Secure in production, so the browser accepts the 200 and then
  // silently discards them, and the guard below bounces the user back to
  // /login with no error to show. Upgrading here means that cannot happen even
  // when the edge's "Always Use HTTPS" rule is off. Built from the Host header
  // rather than nextUrl, which carries the loopback origin behind the tunnel.
  // Next fills in x-forwarded-proto itself for a direct plain-HTTP connection,
  // so this must exempt loopback or hitting the origin directly (dev, probes,
  // the tunnel's own health checks) would bounce to https://127.0.0.1:7010,
  // which serves no TLS. Public traffic arrives with the real Host set by
  // Cloudflare, which is the only case worth upgrading.
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("host") ?? "";
  const isLoopback =
    host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
  if (forwardedProto === "http" && host && !isLoopback) {
    return NextResponse.redirect(`https://${host}${pathname}${search}`, 308);
  }
  const signedIn =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAlways = ALWAYS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isAlways) return NextResponse.next();

  if (!signedIn && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
