import { NextRequest } from "next/server";
import { exchange } from "../login/route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return exchange(req, "register");
}
