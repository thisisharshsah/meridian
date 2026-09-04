import { NextResponse } from "next/server";
import { getAccessToken, getRefreshToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Reports whether the session cookies actually arrived. A login POST can return
 * 200 while the browser drops the Set-Cookie entirely -- Secure cookies are
 * discarded on a plain http:// page -- and without a way to ask, the form has
 * no idea and navigates away into a redirect loop with nothing to show.
 */
export async function GET() {
  const signedIn = Boolean((await getAccessToken()) || (await getRefreshToken()));
  return NextResponse.json({ signedIn });
}
