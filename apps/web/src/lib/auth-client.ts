type SessionResult =
  | { ok: true }
  | { ok: false; message: string; fields: Record<string, string> };

/**
 * Posts to the Next.js session routes, which hold the tokens in httpOnly
 * cookies. Field errors from the Rust API come back keyed by field so the form
 * can attach them to the right input.
 */
export async function submitSession(
  endpoint: "login" | "register",
  values: unknown,
): Promise<SessionResult> {
  let res: Response;
  try {
    res = await fetch(`/api/session/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
  } catch {
    return { ok: false, message: "Cannot reach the server. Is it running?", fields: {} };
  }

  if (res.ok) return { ok: true };

  const body = await res.json().catch(() => null);
  const err = body?.error;
  const fields: Record<string, string> = Object.fromEntries(
    (err?.fields ?? []).map((f: { field: string; message: string }) => [f.field, f.message]),
  );
  return { ok: false, message: err?.message ?? "Something went wrong", fields };
}
