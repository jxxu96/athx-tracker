import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayAllowed } from "./gateway.ts";

const allowed = (url: string) => assert.ok(gatewayAllowed(url), `${url} should be allowed`);
const refused = (url: string) => assert.ok(!gatewayAllowed(url), `${url} should be refused`);

test("https is allowed wherever it points", () => {
  allowed("https://example.com");
  allowed("https://friend-server.tail9878f8.ts.net");
  allowed("https://10.0.0.5:8787");
});

test("plain http is allowed only where it cannot leave the network", () => {
  allowed("http://localhost:3000");
  allowed("http://127.0.0.1:8787");
  allowed("http://127.1.2.3");
  allowed("http://estimator:8787");
  allowed("http://10.0.0.5:8787");
  allowed("http://192.168.1.10");
  allowed("http://172.16.0.1");
  allowed("http://172.31.255.254");
  allowed("http://100.105.137.54");
  allowed("http://friend-server.tail9878f8.ts.net");
});

test("a name that merely begins like an address is still a name", () => {
  // The bug: these matched the ranges by prefix, so the token went to somebody
  // else's domain in clear text.
  refused("http://10.0.0.1.evil.com");
  refused("http://192.168.evil.com");
  refused("http://172.16.evil.com");
  refused("http://100.64.evil.com");
  refused("http://127.0.0.1.evil.com");
});

test("public addresses and names are refused over http", () => {
  refused("http://1.2.3.4");
  refused("http://example.com");
  refused("http://grafana.example.com");
  refused("http://8.8.8.8");
});

test("addresses just outside each range are refused", () => {
  refused("http://11.0.0.1");
  refused("http://192.169.1.1");
  refused("http://172.15.0.1");
  refused("http://172.32.0.1");
  refused("http://100.63.0.1");
  refused("http://100.128.0.1");
});

test("something that is not a usable address is refused", () => {
  refused("http://10.0.0.1.2");
  refused("http://10.0.0.999");
  refused("http://10.0.0.-1");
});

test("an address written oddly is still the address it is", () => {
  // The URL parser canonicalises these before the check sees them, so a hex
  // or decimal spelling cannot smuggle a public address past as a name, and
  // does not make a private one unrecognisable either.
  allowed("http://10.0.0");       // 10.0.0.0
  allowed("http://10.0.0.0x1");   // 10.0.0.1
  allowed("http://0x0a000001");   // 10.0.0.1
  allowed("http://167772161");    // 10.0.0.1
  refused("http://0x08080808");   // 8.8.8.8
  refused("http://134744072");    // 8.8.8.8
});

test("only http and https are considered at all", () => {
  refused("ftp://10.0.0.5");
  refused("file:///etc/passwd");
  refused("javascript:alert(1)");
  refused("not a url");
  refused("");
});

test("a tailnet name has to actually end there", () => {
  allowed("http://box.ts.net");
  refused("http://ts.net.evil.com");
  refused("http://evil.com/.ts.net");
});
