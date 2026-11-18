import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { here } from "./config.mjs";

// Automatic backups. The journal lives on a machine you do not own, so a copy
// is pulled to this one on a timer. Same reasoning as the estimator: the work
// happens where you control the hardware.
const BACKUP_URL = (process.env.BACKUP_URL ?? "").replace(/\/+$/, "");
const BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? join(here, "backups");
const BACKUP_EVERY_HOURS = Number(process.env.BACKUP_EVERY_HOURS ?? 12);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 30);

/** The app derives its cookie key from the passphrase, so we can mint one. */
function sessionCookie() {
  const key = createHash("sha256")
    .update(`athx-session:${BACKUP_PASSPHRASE}`)
    .digest();
  const expiry = Date.now() + 5 * 60 * 1000;
  const mac = createHmac("sha256", key).update(String(expiry)).digest("hex");
  return `athx_session=${expiry}.${mac}`;
}

async function runBackup() {
  const cookie = sessionCookie();
  const fetchJson = async (path) => {
    const response = await fetch(BACKUP_URL + path, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  };

  const [entries, config] = await Promise.all([
    fetchJson("/api/records"),
    fetchJson("/api/settings"),
  ]);
  const records = Array.isArray(entries.records) ? entries.records : [];
  // An empty journal is more likely a fault than a fact; never overwrite on it.
  if (records.length === 0) {
    console.warn("[backup] the journal came back empty; not writing a file");
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `athx-journal-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(
    join(BACKUP_DIR, name),
    JSON.stringify(
      {
        app: "athx-tracker",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: config.settings,
        records,
      },
      null,
      2,
    ),
  );

  const kept = readdirSync(BACKUP_DIR)
    .filter((file) => file.startsWith("athx-journal-") && file.endsWith(".json"))
    .sort()
    .reverse();
  for (const stale of kept.slice(BACKUP_KEEP))
    rmSync(join(BACKUP_DIR, stale), { force: true });

  console.log(
    `[backup] ${records.length} entries -> ${name} (${Math.min(kept.length, BACKUP_KEEP)} kept)`,
  );
}

export function startBackups() {
  if (!BACKUP_URL || !BACKUP_PASSPHRASE) {
    console.log("[backup] not configured; set BACKUP_URL and BACKUP_PASSPHRASE");
    return;
  }
  const every = BACKUP_EVERY_HOURS * 3600_000;
  const RETRY_MS = 5 * 60 * 1000;
  const tick = async () => {
    let wait = every;
    try {
      await runBackup();
    } catch (error) {
      // Beside the app, both start at once and the first attempt can beat it
      // up. Waiting the full period on that would leave a day unprotected.
      console.error(
        `[backup] failed: ${error.message}; trying again in ${RETRY_MS / 60000}m`,
      );
      wait = RETRY_MS;
    }
    setTimeout(tick, wait).unref?.();
  };
  // One shortly after start, so a problem surfaces now rather than in 12 hours.
  setTimeout(tick, 30_000).unref?.();
  console.log(
    `[backup] every ${BACKUP_EVERY_HOURS}h from ${BACKUP_URL} into ${BACKUP_DIR}, keeping ${BACKUP_KEEP}`,
  );
}
