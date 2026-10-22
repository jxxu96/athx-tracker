import { database, guard, json, readBody } from "@/lib/server";
import { recordSchema } from "@/lib/validation";

export async function GET(request: Request) {
  const rejected = await guard(request);
  if (rejected) return rejected;
  // Omitting the limit returns the whole journal, which is what the backup job
  // asks for and must keep getting.
  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? asked : null;
  const order = "SELECT payload FROM records ORDER BY day DESC, created_at DESC";
  const rows = (
    limit
      ? database().prepare(`${order} LIMIT ?`).all(limit)
      : database().prepare(order).all()
  ) as { payload: string }[];
  const { total } = database()
    .prepare("SELECT COUNT(*) AS total FROM records")
    .get() as { total: number };
  return json({ records: rows.map((row) => JSON.parse(row.payload)), total });
}

export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  try {
    const record = recordSchema.parse(await readBody(request));
    database()
      .prepare(
        "INSERT INTO records (id, kind, athlete, day, payload, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET athlete=excluded.athlete, day=excluded.day, payload=excluded.payload WHERE records.kind=excluded.kind",
      )
      .run(
        record.id,
        record.kind,
        record.athlete,
        record.day,
        JSON.stringify(record),
        new Date().toISOString(),
      );
    return json({ record });
  } catch {
    return json(
      {
        error:
          "Check the entry: use valid dates, non-negative numbers, and station times no longer than the workout.",
      },
      400,
    );
  }
}

export async function DELETE(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  try {
    const { id } = await readBody(request);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
      return json({ error: "Invalid record." }, 400);
    database().prepare("DELETE FROM records WHERE id = ?").run(id);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not delete entry." }, 400);
  }
}
