import { Tracker } from "@/components/tracker";
import {
  DEFAULT_SETTINGS,
  localDay,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import { database, runtime } from "@/lib/server";
import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";

// The journal is per-request: it depends on the injected identity headers.
export const dynamic = "force-dynamic";

/** Hand the first screen straight to the device, with no client round-trip. */
async function readJournal() {
  const [entries, saved] = await Promise.all([
    database()
      .prepare("SELECT payload FROM records ORDER BY day DESC, created_at DESC")
      .all<{ payload: string }>(),
    database()
      .prepare("SELECT payload, revision FROM settings WHERE id = 'team'")
      .first<{ payload: string; revision: number }>(),
  ]);
  return {
    records: entries.results.map((row) => JSON.parse(row.payload) as RecordItem),
    settings: saved ? (JSON.parse(saved.payload) as Settings) : DEFAULT_SETTINGS,
    revision: saved?.revision ?? 0,
  };
}

export default async function Home() {
  await requireChatGPTUser("/");

  const config = runtime();
  const journal = await readJournal().catch(() => null);

  return (
    <Tracker
      today={localDay()}
      signOutPath={chatGPTSignOutPath("/")}
      grokReady={Boolean(
        config.XAI_API_KEY ||
          (config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN),
      )}
      records={journal?.records ?? []}
      settings={journal?.settings ?? DEFAULT_SETTINGS}
      revision={journal?.revision ?? 0}
      loadError={
        journal
          ? ""
          : "Your journal could not be opened. If this site was just published, its database may still be setting up."
      }
    />
  );
}
