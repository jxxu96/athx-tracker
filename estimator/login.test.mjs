import { test } from "node:test";
import assert from "node:assert/strict";
import { loginExpiresAt, loginWatch } from "./login.mjs";

// The shape `claude auth status` prints, trimmed to what matters here.
const status = (loginExpiresAt) =>
  JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", loginExpiresAt });

test("the sign-in's end is read from claude auth status", () => {
  assert.equal(loginExpiresAt(status("2026-11-26T15:04:05.000Z")), "2026-11-26T15:04:05.000Z");
  // Whatever form the time comes in, it leaves as one ISO form.
  assert.equal(loginExpiresAt(status("2026-11-26T10:04:05-05:00")), "2026-11-26T15:04:05.000Z");
  // None on record, a token login, no login, or something else entirely: null.
  assert.equal(loginExpiresAt(status(null)), null);
  assert.equal(loginExpiresAt(JSON.stringify({ loggedIn: false })), null);
  assert.equal(loginExpiresAt(status("soon")), null);
  assert.equal(loginExpiresAt(status(1795705445000)), null);
  for (const junk of ["", "Not logged in", "null", "[]", undefined]) assert.equal(loginExpiresAt(junk), null);
});

test("the CLI is asked at most once in a while, and once for callers at the same time", async () => {
  let now = 0;
  const calls = [];
  let answer = status("2026-11-26T15:04:05.000Z");
  const watch = loginWatch({
    bin: "/usr/local/bin/claude",
    clock: () => now,
    freshMs: 1000,
    runner: async (bin, args, timeoutMs) => {
      calls.push({ bin, args, timeoutMs });
      return { code: 0, out: answer, err: "", timedOut: false };
    },
  });
  const [first, second] = await Promise.all([watch(), watch()]);
  assert.equal(first, "2026-11-26T15:04:05.000Z");
  assert.equal(second, first);
  assert.deepEqual(calls, [{ bin: "/usr/local/bin/claude", args: ["auth", "status", "--json"], timeoutMs: 4000 }]);

  // Within the window the kept answer stands, even after a new sign-in.
  answer = status("2027-01-10T09:00:00.000Z");
  now = 999;
  assert.equal(await watch(), "2026-11-26T15:04:05.000Z");
  assert.equal(calls.length, 1);
  now = 1000;
  assert.equal(await watch(), "2027-01-10T09:00:00.000Z");
  assert.equal(calls.length, 2);
});

test("a CLI that fails or is missing gives null, and is not asked again at once", async () => {
  let calls = 0;
  const failing = loginWatch({
    bin: "claude",
    clock: () => 0,
    runner: async () => {
      calls += 1;
      return { code: 1, out: "", err: "boom", timedOut: false };
    },
  });
  assert.equal(await failing(), null);
  assert.equal(await failing(), null);
  assert.equal(calls, 1);

  const throwing = loginWatch({ bin: "claude", runner: () => Promise.reject(new Error("spawn failed")) });
  assert.equal(await throwing(), null);

  const absent = loginWatch({ bin: "", runner: () => assert.fail("no binary, no run") });
  assert.equal(await absent(), null);
});
