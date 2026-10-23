/**
 * Four numbers and nothing else. "10.0.0.1.evil.com" starts like an address
 * and is a name somebody else controls, which is the whole point of checking.
 */
function ipv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

/**
 * A gateway must be HTTPS on the open internet, but plain HTTP is fine when the
 * host is on a private network or a tailnet, where the transport is already
 * encrypted and the estimator is not publicly reachable.
 *
 * The ranges were matched with anchored prefixes against the hostname, so any
 * domain beginning with one passed: 192.168.example.com was a private network
 * as far as this was concerned, and the token went to it in clear text. The
 * host has to parse as an address before an address range means anything.
 */
export function gatewayAllowed(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;

  const host = url.hostname;
  if (host === "localhost") return true;
  // A single-label name resolves only on a container or local network, never
  // publicly, so names like the compose service "estimator" are private too.
  if (!host.includes(".")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".ts.net")) return true;

  const octets = ipv4(host);
  if (!octets) return false;
  const [first, second] = octets;
  if (first === 127) return true;
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  // Tailscale hands out 100.64.0.0/10.
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}
