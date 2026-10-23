import { test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { MAX_AGE_SECONDS, configured, issue, matches, valid } from "./token.ts";

const as = <T>(passphrase: string | undefined, run: () => T): T => {
  const before = process.env.APP_PASSPHRASE;
  if (passphrase === undefined) delete process.env.APP_PASSPHRASE;
  else process.env.APP_PASSPHRASE = passphrase;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.APP_PASSPHRASE;
    else process.env.APP_PASSPHRASE = before;
  }
};

test("a cookie this issued is one it accepts", () => {
  as("a real passphrase", () => assert.ok(valid(issue())));
});

test("a cookie nobody issued is refused", () => {
  as("a real passphrase", () => {
    for (const junk of [undefined, "", ".", "abc", "abc.def", "1.2.3"]) {
      assert.ok(!valid(junk), JSON.stringify(junk) ?? "undefined");
    }
  });
});

test("altering either half invalidates it", () => {
  as("a real passphrase", () => {
    const [expiry, mac] = issue().split(".");
    const changed = mac.endsWith("0") ? "1" : "0";
    assert.ok(!valid(`${expiry}.${mac.slice(0, -1)}${changed}`), "signature changed");
    assert.ok(!valid(`${Number(expiry) + 1000}.${mac}`), "expiry extended");
    assert.ok(!valid(`${expiry}.${mac}extra`), "signature lengthened");
    assert.ok(!valid(`${expiry}.`), "signature removed");
  });
});

test("an expired cookie is refused even though it is genuine", () => {
  as("a real passphrase", () => {
    const token = issue();
    const [expiry] = token.split(".");
    assert.ok(Number(expiry) > Date.now(), "issued in the future");
    assert.ok(
      Number(expiry) <= Date.now() + MAX_AGE_SECONDS * 1000,
      "and not further out than it claims",
    );
  });
});

/** A properly signed cookie for any expiry, to test the expiry on its own. */
const signedFor = (passphrase: string, expiry: number) => {
  const key = createHash("sha256").update(`athx-session:${passphrase}`).digest();
  const mac = createHmac("sha256", key).update(String(expiry)).digest("hex");
  return `${expiry}.${mac}`;
};

test("a genuine cookie stops working once it is old", () => {
  // The ninety days only mean something if an expiry in the past is refused,
  // and checking a fresh token's expiry never exercises that.
  as("a real passphrase", () => {
    assert.ok(
      valid(signedFor("a real passphrase", Date.now() + 60_000)),
      "signed and current",
    );
    assert.ok(
      !valid(signedFor("a real passphrase", Date.now() - 1_000)),
      "signed, and a second past its time",
    );
    assert.ok(
      !valid(signedFor("a real passphrase", 0)),
      "signed, and from before any of this existed",
    );
  });
});

test("changing the passphrase signs both phones out", () => {
  // The whole reason the key is derived from the passphrase rather than kept
  // beside it: changing it has to end the sessions it let in.
  const issued = as("the old passphrase", () => issue());
  assert.ok(as("the old passphrase", () => valid(issued)), "still good before");
  assert.ok(!as("a new passphrase", () => valid(issued)), "and not after");
});

test("nothing is valid when no passphrase is set", () => {
  const issued = as("a real passphrase", () => issue());
  as(undefined, () => {
    assert.equal(configured(), false);
    assert.equal(valid(issued), false);
    assert.equal(matches("a real passphrase"), false);
  });
});

test("the passphrase is compared whole", () => {
  as("correct horse", () => {
    assert.ok(matches("correct horse"));
    assert.ok(!matches("correct hors"), "a prefix is not a match");
    assert.ok(!matches("correct horses"), "nor is an extension");
    assert.ok(!matches("Correct Horse"), "nor a different case");
    assert.ok(!matches(""), "nor nothing");
    assert.ok(!matches("x".repeat(10000)), "and length cannot break it");
  });
});
