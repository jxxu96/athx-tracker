import { redirect } from "next/navigation";
import { Tracker } from "@/components/tracker";
import {
  DEFAULT_SETTINGS,
  RECENT_LIMIT,
  localDay,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import { signedIn } from "@/lib/auth";
import { database, runtime } from "@/lib/server";

// The journal depends on the session cookie, so it is never statically rendered.
export const dynamic = "force-dynamic";

/** Hand the first screen straight to the device, with no client round-trip. */
function readJournal() {
  try {
    const rows = database()
      .prepare(
        "SELECT payload FROM records ORDER BY day DESC, created_at DESC LIMIT ?",
      )
      .all(RECENT_LIMIT) as { payload: string }[];
    const { total } = database()
      .prepare("SELECT COUNT(*) AS total FROM records")
      .get() as { total: number };
    const saved = database()
      .prepare("SELECT payload, revision FROM settings WHERE id = 'team'")
      .get() as { payload: string; revision: number } | undefined;
    return {
      records: rows.map((row) => JSON.parse(row.payload) as RecordItem),
      total,
      settings: saved
        ? (JSON.parse(saved.payload) as Settings)
        : DEFAULT_SETTINGS,
      revision: saved?.revision ?? 0,
    };
  } catch {
    return null;
  }
}

export default async function Home() {
  if (!(await signedIn())) redirect("/login");

  const config = runtime();
  const journal = readJournal();

  return (
    <Tracker
      today={localDay()}
      grokReady={Boolean(
        config.XAI_API_KEY ||
          (config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN),
      )}
      records={journal?.records ?? []}
      total={journal?.total ?? 0}
      settings={journal?.settings ?? DEFAULT_SETTINGS}
      revision={journal?.revision ?? 0}
      loadError={
        journal
          ? ""
          : "Your journal could not be opened. Check that the data volume is writable."
      }
    />
  );
}
