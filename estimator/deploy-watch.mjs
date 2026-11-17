import { request as httpsRequest } from "node:https";
// Loads estimator/.env before the settings below are read.
import "./config.mjs";

// Deploy trigger. GitHub Actions cannot reach a tailnet address, so CI cannot
// call Portainer directly. This machine can reach both, so it watches the
// registry for a new image and tells Portainer when one appears. That removes
// the race where Portainer polls git and pulls an image that is not built yet.
const DEPLOY_WEBHOOK = process.env.DEPLOY_WEBHOOK ?? "";
const DEPLOY_IMAGE = process.env.DEPLOY_IMAGE ?? "jxxu96/athx-tracker";
const DEPLOY_EVERY_MINUTES = Number(process.env.DEPLOY_EVERY_MINUTES ?? 5);
let lastDigest = "";

async function currentDigest() {
  const auth = await fetch(
    `https://ghcr.io/token?scope=repository:${DEPLOY_IMAGE}:pull&service=ghcr.io`,
    { signal: AbortSignal.timeout(15000) },
  );
  const { token } = await auth.json();
  const response = await fetch(
    `https://ghcr.io/v2/${DEPLOY_IMAGE}/manifests/latest`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  return response.headers.get("docker-content-digest") ?? "";
}

/** Portainer serves its own certificate, so this one call does not verify it. */
function postWebhook(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "POST",
        rejectUnauthorized: false,
        timeout: 20000,
      },
      (response) => {
        response.resume();
        response.statusCode && response.statusCode < 400
          ? resolve(response.statusCode)
          : reject(new Error(`webhook returned ${response.statusCode}`));
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("webhook timed out")));
    request.end();
  });
}

async function checkForNewImage() {
  const digest = await currentDigest();
  if (!digest) return;
  if (!lastDigest) {
    // First look only records what is already deployed; it does not redeploy.
    lastDigest = digest;
    console.log(`[deploy] watching ${DEPLOY_IMAGE}, current ${digest.slice(0, 19)}`);
    return;
  }
  if (digest === lastDigest) return;
  console.log(`[deploy] new image ${digest.slice(0, 19)}, telling Portainer`);
  const status = await postWebhook(DEPLOY_WEBHOOK);
  // Recorded only once Portainer has accepted it. Recording it first loses the
  // deploy for good when the call fails, instead of retrying on the next tick.
  lastDigest = digest;
  console.log(`[deploy] Portainer accepted the redeploy (${status})`);
}

export function startDeployWatch() {
  if (!DEPLOY_WEBHOOK) {
    console.log("[deploy] not configured; set DEPLOY_WEBHOOK to auto-redeploy");
    return;
  }
  const tick = () =>
    checkForNewImage().catch((error) =>
      console.error(`[deploy] check failed: ${error.message}`),
    );
  tick();
  setInterval(tick, DEPLOY_EVERY_MINUTES * 60_000).unref?.();
  console.log(`[deploy] checking ${DEPLOY_IMAGE} every ${DEPLOY_EVERY_MINUTES}m`);
}
