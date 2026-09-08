import { NextRequest } from "next/server";
import { reissue } from "../switch/route";

export const dynamic = "force-dynamic";

/**
 * Start another business under the same login. The reply carries a session for
 * the new workspace, so the person lands inside it rather than being sent back
 * to a sign-in screen for a business they just created.
 */
export async function POST(req: NextRequest) {
  return reissue(req, "workspaces", await req.json());
}
