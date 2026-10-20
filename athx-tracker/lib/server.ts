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
 * One shared passphrase gates the whole journal. There is no per-user data here:
 * both athletes read and write the same records, so identity is not the question,
 * only whether the visitor is one of them.
 */
export async function guard(request: Request, write = false) {
  if (!(await signedIn())) return json({ error: "Sign in to open your journal." }, 401);
  if (write) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: "Invalid request origin." }, 403);
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
