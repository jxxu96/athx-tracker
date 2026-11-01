import { BodyTooLarge, database, guard, json, readBody, tooLarge } from "@/lib/server";
import { newBests } from "@/lib/bests";
import type { RecordItem, Workout } from "@/lib/domain";
import { readRecords, readRecordsBetween, readRecordsOn } from "@/lib/journal";
import { kickQueue } from "@/lib/queue";
import { daySchema, recordSchema } from "@/lib/validation";
import { ZodError } from "zod";

const KINDS: RecordItem["kind"][] = ["workout", "meal", "bodyweight"];

export async function GET(request: Request) {
  const rejected = await guard(request);
  if (rejected) return rejected;
  const params = new URL(request.url).searchParams;
  const day = params.get("day");
  if (day !== null) {
    if (!daySchema.safeParse(day).success)
      return json({ error: "Choose a valid calendar date." }, 400);
    const records = readRecordsOn(day);
    return json({ records, total: records.length });
  }
  if (params.has("from") || params.has("to")) {
    const from = daySchema.safeParse(params.get("from"));
    const to = daySchema.safeParse(params.get("to"));
    if (!from.success || !to.success || from.data > to.data)
      return json({ error: "Choose a valid range of dates." }, 400);
    const kind = params.get("kind");
    const only = KINDS.find((item) => item === kind);
    if (kind !== null && !only) return json({ error: "Choose a valid kind of entry." }, 400);
    const records = readRecordsBetween(from.data, to.data, only);
    return json({ records, total: records.length });
  }
  // Omitting the limit returns the whole journal, which is what the backup job
  // asks for and must keep getting.
  const asked = Number(params.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? asked : null;
  const { records, total } = readRecords(limit);
  return json({ records, total });
}

/**
 * The lifts a session beats, against the athlete's sessions already saved,
 * the earlier version of this one included, so saving an edit announces
 * nothing it already held. Worked out here because only the server has the
 * whole journal.
 */
function bestsFor(record: Workout) {
  if (record.athlete === "team" || record.lifts.length === 0) return [];
  // A notice is a courtesy, and must never be the reason a save fails.
  try {
    const rows = database()
      .prepare("SELECT payload FROM records WHERE kind = 'workout' AND athlete = ?")
      .all(record.athlete) as { payload: string }[];
    return newBests(record, rows.map((row) => JSON.parse(row.payload) as Workout));
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  try {
    const record = recordSchema.parse(await readBody(request));
    const bests = record.kind === "workout" ? bestsFor(record) : [];
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
    // Saved to be estimated in the background: start now, not at the timer.
    if (record.kind === "meal" && record.source === "queued") kickQueue();
    return json({ record, ...(bests.length ? { newBests: bests } : {}) });
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    if (error instanceof ZodError) {
      const mismatch = error.issues.find((issue) =>
        issue.code === "custom" && issue.path.join(".") === "macros.calories",
      );
      if (mismatch) return json({ error: mismatch.message }, 400);
    }
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
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json({ error: "Could not delete entry." }, 400);
  }
}
