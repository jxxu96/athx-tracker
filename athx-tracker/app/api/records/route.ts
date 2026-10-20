import { database, guard, json, readBody } from "@/lib/server";
import { recordSchema } from "@/lib/validation";
export async function GET(request: Request) {
  const rejected = guard(request); if (rejected) return rejected;
  const result = await database().prepare("SELECT payload FROM records ORDER BY day DESC, created_at DESC").all<{ payload: string }>();
  return json({ records: result.results.map(r => JSON.parse(r.payload)) });
}
export async function POST(request: Request) {
  const rejected = guard(request, true); if (rejected) return rejected;
  try {
    const record = recordSchema.parse(await readBody(request));
    await database().prepare("INSERT INTO records (id, kind, athlete, day, payload, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET athlete=excluded.athlete, day=excluded.day, payload=excluded.payload WHERE records.kind=excluded.kind")
      .bind(record.id, record.kind, record.athlete, record.day, JSON.stringify(record), new Date().toISOString()).run();
    return json({ record });
  } catch { return json({ error: "Check the entry: use valid dates, non-negative numbers, and station times no longer than the workout." }, 400); }
}
export async function DELETE(request: Request) {
  const rejected = guard(request, true); if (rejected) return rejected;
  try {
    const { id } = await readBody(request);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) return json({ error: "Invalid record." }, 400);
    await database().prepare("DELETE FROM records WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch { return json({ error: "Could not delete entry." }, 400); }
}
