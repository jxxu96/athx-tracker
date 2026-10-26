import { db } from "./db";
import { signedIn } from "./auth";

export function database() {
  return db();
}

/** Setup's food notes, or nothing when Setup has never been saved. */
export function storedFoodNotes() {
  const row = database()
    .prepare("SELECT payload FROM settings WHERE id = 'team'")
    .get() as { payload: string } | undefined;
  if (!row) return "";
  const notes = (JSON.parse(row.payload) as { foodNotes?: unknown }).foodNotes;
  return typeof notes === "string" ? notes : "";
}

export function runtime() {
  return process.env as {
    XAI_API_KEY?: string;
    XAI_MODEL?: string;
    GROK_GATEWAY_URL?: string;
    GROK_GATEWAY_TOKEN?: string;
  };
}

/** 413 and a reason, for anything that never got as far as being parsed. */
export function tooLarge() {
  return json({ error: "That was too large to read. Nothing was saved." }, 413);
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

const MAX_BODY_BYTES = 64_000;

/**
 * Distinct from a body that parsed and was wrong. Both used to come back as
 * "check the entry", which is unhelpful to whoever sent it and means the cap
 * cannot be told apart from the schema refusing the same thing: no test could
 * see whether it was still there.
 */
export class BodyTooLarge extends Error {
  constructor() {
    super("Request too large.");
    this.name = "BodyTooLarge";
  }
}

/**
 * Reads up to a cap rather than buffering the whole body and measuring after.
 * The old order held an arbitrarily large request in memory before deciding it
 * was too large, which is the wrong way round for the only thing that limit was
 * there to prevent. Content-Length is checked first where it is given, but it
 * is a claim, so the read is bounded regardless.
 */
export async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new BodyTooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty body.");

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}
