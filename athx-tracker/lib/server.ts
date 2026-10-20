import { env } from "cloudflare:workers";
export function database(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}
export function runtime() {
  return env as unknown as { XAI_API_KEY?: string; XAI_MODEL?: string; GROK_GATEWAY_URL?: string; GROK_GATEWAY_TOKEN?: string };
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function guard(request: Request, write = false) {
  // Hosted dispatch authenticates and authorizes the private Site audience.
  if (!request.headers.get("oai-authenticated-user-id")) return json({ error: "Sign in to access your team." }, 401);
  if (write) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON required." }, 415);
  }
  return null;
}
export async function readBody(request: Request) {
  const text = await request.text();
  if (text.length > 64000) throw new Error("Request too large.");
  return JSON.parse(text);
}
