// Draws the app icons from the running hippo in components/creatures.tsx,
// the frame with its front foot down, on the app's dark background.
// Run from athx-tracker/: node scripts/make-icons.mjs
// Writes public/favicon.svg and the PNGs the home screens need: iPhones take
// no SVG for an apple-touch-icon, and Android masks its own icon to a circle,
// which wants the art inside the middle 80%.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BACKGROUND = "#0a0a0a";
const HIPPO = "#a898a8";
const HIPPO_D = "#786880";
const HIPPO_L = "#c8b8c8";
const PINK = "#e8a0b0";
const EYE = "#f8f8f0";
const PUPIL = "#202028";

/** [x, y, width, height] in the sprite's 16×16 pixels, as creatures.tsx draws them. */
const LAYERS = [
  [HIPPO_D, [[3, 7, 10, 6]]],
  [HIPPO, [[4, 7, 8, 5]]],
  [HIPPO_L, [[5, 9, 6, 3]]],
  [HIPPO, [[3, 3, 10, 6]]],
  [HIPPO_L, [[4, 5, 8, 3]]],
  [HIPPO, [[9, 5, 6, 4]]],
  [PINK, [[10, 7, 4, 1]]],
  [HIPPO_D, [[10, 5, 1, 1], [12, 5, 1, 1], [3, 2, 2, 2], [11, 2, 2, 2]]],
  [PINK, [[3, 3, 1, 1], [12, 3, 1, 1]]],
  [EYE, [[5, 4, 2, 2], [9, 4, 2, 2]]],
  [PUPIL, [[6, 4, 1, 2], [10, 4, 1, 2]]],
  [HIPPO_D, [[3, 12, 3, 2], [10, 11, 3, 2]]],
];

const art = LAYERS.flatMap(([fill, boxes]) =>
  boxes.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`),
).join("");

/**
 * The art spans x 3–15 and y 2–14, centred on (9, 8). size is the square of
 * sprite pixels the icon shows: more of them is more room around the hippo.
 */
function svg(size, rounded) {
  const x = 9 - size / 2;
  const y = 8 - size / 2;
  const corner = rounded ? size * 0.2 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${corner}" fill="${BACKGROUND}"/>` +
    `<ellipse cx="8" cy="14.5" rx="6" ry="1.5" fill="rgba(255,255,255,0.08)" shape-rendering="auto"/>${art}</svg>`;
}

// The browser tab's icon: rounded, with the hippo filling most of it.
writeFileSync("public/favicon.svg", `${svg(17, true)}\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(file, pixels, size) {
  await page.setViewportSize({ width: pixels, height: pixels });
  const source = Buffer.from(svg(size, false)).toString("base64");
  await page.setContent(
    `<html><body style="margin:0"><img src="data:image/svg+xml;base64,${source}" width="${pixels}" height="${pixels}" style="display:block;image-rendering:pixelated"></body></html>`,
  );
  await page.locator("img").screenshot({ path: file, omitBackground: false });
}
// Square and opaque: iPhones round the corners themselves, and fill a
// transparent icon with black.
await png("public/apple-touch-icon.png", 180, 18);
await png("public/icon-192.png", 192, 18);
await png("public/icon-512.png", 512, 18);
// Android crops to a circle 80% across; the hippo sits well inside it.
await png("public/icon-maskable-512.png", 512, 25);
await browser.close();
