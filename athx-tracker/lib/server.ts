import { db } from "./db";
import { signedIn } from "./auth";

export function database() {
  return db();
}

export function runtime() {
  return process.env as {
    XAI_API_KEY?: string;
    XAI_MODEL?: string;
    GROK_GATEWAY_URL?: string;
    GROK_GATEWAY_TOKEN?: string;
  };
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Cross-site write protection.
 *
 * This compared the Origin header against request.url, which behind a proxy is
 * the container's own address and never the public hostname, so every browser
 * write was refused. Compare against the host the client actually asked for
 * instead, which a proxy reports in x-forwarded-host or passes through in host.
 *
 * The session cookie is already SameSite=Lax, so this is the second of two
 * defences rather than the only one.
 */
function sameSite(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const first = (value: string | null) => value?.split(",")[0].trim() ?? "";
  const allowed = [
    first(request.headers.get("x-forwarded-host")),
    first(request.headers.get("host")),
    process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).host : "",
  ].filter(Boolean);

  return allowed.includes(originHost);
}

/**
 * One shared passphrase gates the whole journal. There is no per-user data here:
 * both athletes read and write the same records, so identity is not the question,
 * only whether the visitor is one of them.
 */
export async function guard(request: Request, write = false) {
  if (!(await signedIn())) return json({ error: "Sign in to open your journal." }, 401);
  if (write) {
    if (!sameSite(request)) return json({ error: "Invalid request origin." }, 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
      return json({ error: "JSON required." }, 415);
  }
  return null;
}

export async function readBody(request: Request) {
  const text = await request.text();
  if (text.length > 64000) throw new Error("Request too large.");
  return JSON.parse(text);
}
