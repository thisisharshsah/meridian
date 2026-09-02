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
