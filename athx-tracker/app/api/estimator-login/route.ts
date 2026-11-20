import { guard, json, runtime } from "@/lib/server";
import { gatewayAllowed } from "@/lib/gateway";
import { readExpiry } from "@/lib/login-expiry";

export const dynamic = "force-dynamic";

/**
 * When the estimator's Claude sign-in runs out, for the alert that warns ahead
 * of it. Null whenever that cannot be told: no estimator, one that is asleep
 * or older than this field, Claude not asked, or a login with no end on record.
 */
export async function GET(request: Request) {
  const rejected = await guard(request);
  if (rejected) return rejected;
  const config = runtime();
  const none = () => json({ claudeLoginExpiresAt: null });
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN || !gatewayAllowed(config.GROK_GATEWAY_URL))
    return none();
  try {
    const response = await fetch(new URL("/health", config.GROK_GATEWAY_URL), {
      headers: { Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return none();
    const body = (await response.json()) as { claudeLoginExpiresAt?: unknown } | null;
    return json({ claudeLoginExpiresAt: readExpiry(body?.claudeLoginExpiresAt) });
  } catch {
    return none();
  }
}
