import { defineConfig } from "@playwright/test";

/** Test-only, for a database that is created and thrown away. */
export const PASSPHRASE = "e2e-only-passphrase";
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // One worker against one SQLite file: parallel specs would see each other's
  // records and the failures would be about the suite, not the app.
  workers: 1,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // A fresh database each run. Leaving the old one behind made a spec pass
    // once and then fail, because the record it saved was still there the
    // second time, which is a failure about the suite and not about the app.
    command:
      "node -e \"require('fs').rmSync('.playwright',{recursive:true,force:true})\" && npm run build && npm run start",
    url: `http://127.0.0.1:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      APP_PASSPHRASE: PASSPHRASE,
      // Its own file, so a spec can never reach the journal you actually use.
      DATABASE_FILE: ".playwright/athx-e2e.db",
      PORT: String(PORT),
      // Pointed at nothing. It only has to be configured for the estimator
      // controls to render; the specs drive the responses themselves.
      GROK_GATEWAY_URL: "http://127.0.0.1:9",
      GROK_GATEWAY_TOKEN: "e2e-only-gateway-token-00",
    },
  },
});
