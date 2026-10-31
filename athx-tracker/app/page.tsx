import { redirect } from "next/navigation";
import { Tracker } from "@/components/tracker";
import {
  DEFAULT_SETTINGS,
  RECENT_LIMIT,
  localDay,
} from "@/lib/domain";
import { signedIn } from "@/lib/auth";
import { readRecords, readSettings } from "@/lib/journal";
import { runtime } from "@/lib/server";
import { journalSummary } from "@/lib/summary";

// The journal depends on the session cookie, so it is never statically rendered.
export const dynamic = "force-dynamic";

/**
 * Hand the first screen straight to the device, with no client round-trip:
 * the recent slice, and the whole-journal figures worked out from the rest.
 */
function readJournal(today: string) {
  try {
    const { records, all, total } = readRecords(RECENT_LIMIT);
    const saved = readSettings();
    return {
      records,
      total,
      settings: saved?.settings ?? DEFAULT_SETTINGS,
      revision: saved?.revision ?? 0,
      summary: journalSummary(all, saved?.settings, today),
    };
  } catch {
    return null;
  }
}

export default async function Home() {
  if (!(await signedIn())) redirect("/login");

  const config = runtime();
  const today = localDay();
  const journal = readJournal(today);

  return (
    <Tracker
      today={today}
      grokReady={Boolean(
        config.XAI_API_KEY ||
          (config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN),
      )}
      // The background worker asks the gateway only; the direct API is for a
      // click. Offered without it, a meal would stay queued for good.
      queueReady={Boolean(config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN)}
      records={journal?.records ?? []}
      total={journal?.total ?? 0}
      settings={journal?.settings ?? DEFAULT_SETTINGS}
      revision={journal?.revision ?? 0}
      summary={journal?.summary ?? null}
      build={(process.env.BUILD_SHA ?? "unknown").slice(0, 12)}
      loadError={
        journal
          ? ""
          : "Your journal could not be opened. Check that the data volume is writable."
      }
    />
  );
}
