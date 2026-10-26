import { guard, json } from "@/lib/server";
import { localDay } from "@/lib/domain";
import { readRecords, readSettings } from "@/lib/journal";
import { journalSummary } from "@/lib/summary";

/**
 * The whole-journal figures, for a phone holding only the recent slice. The
 * phone says what day it is, because the server's clock may be in another
 * zone, and Progress counts weeks back from that day.
 */
export async function GET(request: Request) {
  const rejected = await guard(request);
  if (rejected) return rejected;
  const asked = new URL(request.url).searchParams.get("today") ?? "";
  const today = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : localDay();
  const { all } = readRecords(null);
  return json({ summary: journalSummary(all, readSettings()?.settings, today) });
}
