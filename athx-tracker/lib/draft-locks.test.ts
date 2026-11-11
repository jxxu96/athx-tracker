import { test } from "node:test";
import assert from "node:assert/strict";
import { claimDraft, draftsElsewhere, refreshElsewhere, releaseDraft } from "./draft-locks.ts";

/**
 * The parts of the Web Locks API the claims use, shared by "this tab" and
 * "another tab": exclusive locks, ifAvailable, giving up on a signal, and a
 * request that settles once its lock is let go.
 */
class FakeLocks {
  held = new Set<string>();
  waiting = new Map<string, (() => void)[]>();

  request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.add(name);
        Promise.resolve(callback({ name, mode: "exclusive" } as Lock)).then((value) => {
          this.held.delete(name);
          this.waiting.get(name)?.shift()?.();
          resolve(value);
        }, reject);
      };
      if (!this.held.has(name)) return grant();
      if (options.ifAvailable) return void Promise.resolve(callback(null)).then(resolve, reject);
      const queue = this.waiting.get(name) ?? [];
      queue.push(grant);
      this.waiting.set(name, queue);
      options.signal?.addEventListener("abort", () => {
        queue.splice(queue.indexOf(grant), 1);
        reject(new DOMException("The request was aborted.", "AbortError"));
      });
    });
  }

  async query() {
    return { held: [...this.held].map((name) => ({ name })), pending: [] };
  }

  /** Another tab holding a draft until the returned function is called. */
  holdElsewhere(id: string) {
    let letGo = () => {};
    void this.request(`athx-draft:${id}`, {}, () => new Promise<void>((done) => (letGo = done)));
    return () => letGo();
  }
}

const locks = new FakeLocks();
Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a draft held here cannot be held elsewhere, and is free once let go", async () => {
  assert.equal(await claimDraft("a"), true);
  assert.equal(locks.held.has("athx-draft:a"), true);
  // Claiming it again joins the claim rather than asking twice.
  assert.equal(await claimDraft("a"), true);
  releaseDraft("a");
  await tick();
  assert.equal(locks.held.has("athx-draft:a"), false);
});

test("a draft another tab has open is not claimed, unless it lets go within the wait", async () => {
  const letGo = locks.holdElsewhere("b");
  assert.equal(await claimDraft("b"), false);
  assert.equal(await claimDraft("b", 20), false);
  const claim = claimDraft("b", 1000);
  letGo();
  assert.equal(await claim, true);
  releaseDraft("b");
});

test("a claim let go of before it was granted lets go at once when it is", async () => {
  const letGo = locks.holdElsewhere("c");
  const claim = claimDraft("c", 1000);
  releaseDraft("c");
  letGo();
  assert.equal(await claim, false);
  await tick();
  assert.equal(locks.held.has("athx-draft:c"), false);
  // Nothing of it is left to join: a new claim asks afresh.
  assert.equal(await claimDraft("c"), true);
  releaseDraft("c");
});

test("only drafts other tabs hold count as elsewhere", async () => {
  const letGo = locks.holdElsewhere("theirs");
  assert.equal(await claimDraft("mine"), true);
  await refreshElsewhere();
  assert.deepEqual([...draftsElsewhere()], ["theirs"]);
  letGo();
  releaseDraft("mine");
  await tick();
  await refreshElsewhere();
  assert.deepEqual([...draftsElsewhere()], []);
});
