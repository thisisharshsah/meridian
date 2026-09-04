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

  if (res.ok) {
    // A 200 does not prove we are signed in. If the page was opened over
    // http://, the browser discards the Secure session cookies without a word,
    // the caller navigates away, the route guard bounces straight back to the
    // form, and the user is left staring at a login page that never said no.
    // Ask the server whether the cookie survived before claiming success.
    const state = await fetch("/api/session/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (state && state.signedIn === false) {
      return {
        ok: false,
        message:
          "Your details were accepted, but the browser did not keep the session cookie. This happens when the page is opened over http:// - open the site with https:// and try again.",
        fields: {},
      };
    }
    return { ok: true };
  }

  // An edge security check (Cloudflare's managed challenge) answers XHR with an
  // HTML interstitial, not JSON. A challenge can only be solved by a top-level
  // navigation, so this request never reached the app at all. Parsing that as
  // JSON fails and the user used to get a bare "Something went wrong", which
  // hides the one fact that matters: the server never saw the credentials.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const challenged = res.headers.get("cf-mitigated") === "challenge" || res.status === 403;
    return {
      ok: false,
      message: challenged
        ? "A security check blocked this request before it reached the server. Your details were not sent. If this keeps happening the site's WAF challenge needs to be scoped away from /api."
        : `The server returned an unexpected ${res.status} response.`,
      fields: {},
    };
  }

  const body = await res.json().catch(() => null);
  const err = body?.error;
  const fields: Record<string, string> = Object.fromEntries(
    (err?.fields ?? []).map((f: { field: string; message: string }) => [f.field, f.message]),
  );
  return { ok: false, message: err?.message ?? "Something went wrong", fields };
}
