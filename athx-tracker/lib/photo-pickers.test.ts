import { test } from "node:test";
import assert from "node:assert/strict";
import { goesThroughIosMenu } from "./photo-pickers.ts";

const iphoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const iphoneChrome =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const ipadMobile =
  "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const macSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const androidChrome =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const windowsChrome =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("an iPhone or iPad goes through iOS's menu, in any of its browsers", () => {
  assert.equal(goesThroughIosMenu({ userAgent: iphoneSafari, platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(goesThroughIosMenu({ userAgent: iphoneChrome, platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(goesThroughIosMenu({ userAgent: ipadMobile, platform: "iPad", maxTouchPoints: 5 }), true);
});

test("an iPad asking for desktop pages is told from a Mac by its touch screen", () => {
  assert.equal(goesThroughIosMenu({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(goesThroughIosMenu({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 0 }), false);
  assert.equal(goesThroughIosMenu({ userAgent: macSafari, maxTouchPoints: 5 }), true, "no platform given");
});

test("Android, Windows and a Mac pick photos their own way", () => {
  assert.equal(goesThroughIosMenu({ userAgent: androidChrome, platform: "Linux armv81", maxTouchPoints: 5 }), false);
  assert.equal(goesThroughIosMenu({ userAgent: windowsChrome, platform: "Win32", maxTouchPoints: 10 }), false);
  assert.equal(goesThroughIosMenu({ userAgent: macSafari, platform: "MacIntel" }), false);
});
