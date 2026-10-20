import { database, guard, json, readBody, runtime } from "@/lib/server";
import { DEFAULT_SETTINGS } from "@/lib/domain";
import { settingsSchema } from "@/lib/validation";
export async function GET(request: Request) {
  const rejected = guard(request); if (rejected) return rejected;
  const row = await database().prepare("SELECT payload, revision FROM settings WHERE id = 'team'").first<{payload:string; revision:number}>();
  const config = runtime();
  return json({ settings: row ? JSON.parse(row.payload) : DEFAULT_SETTINGS, revision: row?.revision ?? 0, grokReady: Boolean(config.XAI_API_KEY || (config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN)) });
}
export async function PUT(request: Request) {
  const rejected = guard(request,true); if (rejected) return rejected;
  try {
    const body = await readBody(request);
    const settings = settingsSchema.parse(body.settings);
    if (!Number.isInteger(body.revision) || body.revision < 0) throw new Error();
    const result = body.revision === 0
      ? await database().prepare("INSERT OR IGNORE INTO settings (id, payload, revision) VALUES ('team', ?, 1)").bind(JSON.stringify(settings)).run()
      : await database().prepare("UPDATE settings SET payload = ?, revision = revision + 1 WHERE id = 'team' AND revision = ?").bind(JSON.stringify(settings), body.revision).run();
    if (!result.meta.changes) return json({ error:"Settings changed on another device. Refresh before saving." },409);
    return json({ settings, revision: body.revision + 1 });
  } catch { return json({ error:"Check your settings and targets." },400); }
}
