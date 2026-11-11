// Draws the app icons from the runners in components/creatures.tsx, the hippo
// and the gator from hippo-city's game/sprites.py, each in its first stride
// frame, on the app's dark background.
// Run from athx-tracker/: node scripts/make-icons.mjs
// Writes public/favicon.svg and public/favicon-gator.svg, which the browser
// tab swaps between (components/favicon-flip.tsx), and the PNGs the home
// screens need: iPhones take no SVG for an apple-touch-icon, and Android masks
// its own icon to a circle, which wants the art inside the middle 80%. A home
// screen icon cannot change, so those stay the hippo.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BACKGROUND = "#0a0a0a";
const HIPPO = "#a898a8";
const HIPPO_D = "#786880";
const HIPPO_L = "#c8b8c8";
const PINK = "#e8a0b0";
const EYE = "#f8f8f0";
const PUPIL = "#202028";
const GATOR = "#489858";
const GATOR_D = "#286838";
const GATOR_L = "#78b870";
const BELLY = "#c8d078";
const TOOTH = "#f8f8e8";

/** [x, y, width, height] in the sprite's 16×16 pixels, as creatures.tsx draws them. */
const HIPPO_LAYERS = [
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

const GATOR_LAYERS = [
  [GATOR_D, [[3, 7, 9, 5]]],
  [GATOR, [[4, 7, 7, 4]]],
  [BELLY, [[5, 9, 5, 2]]],
  [GATOR_D, [[1, 8, 3, 3]]],
  [GATOR, [[0, 9, 2, 2], [9, 4, 6, 5]]],
  [GATOR_L, [[10, 5, 4, 2]]],
  [TOOTH, [[11, 8, 1, 1], [13, 8, 1, 1]]],
  [EYE, [[10, 4, 2, 2]]],
  [PUPIL, [[11, 4, 1, 2]]],
  [GATOR_D, [[5, 5, 1, 2], [7, 5, 1, 2], [9, 5, 1, 2]]],
  [GATOR_D, [[3, 12, 2, 2], [10, 11, 2, 2]]],
];

const draw = (layers) =>
  layers
    .flatMap(([fill, boxes]) =>
      boxes.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`),
    )
    .join("");

/**
 * The hippo spans x 3–15 and y 2–14, centred on (9, 8). The gator spans
 * x 0–15 and y 4–14, centred on (7.5, 9). size is the square of sprite pixels
 * the icon shows: fewer of them is a bigger creature. The shadow under the
 * feet is left off, so the creature itself can take the room.
 */
const HIPPO_ART = { svg: draw(HIPPO_LAYERS), cx: 9, cy: 8 };
const GATOR_ART = { svg: draw(GATOR_LAYERS), cx: 7.5, cy: 9 };

function svg(art, size, rounded) {
  const x = art.cx - size / 2;
  const y = art.cy - size / 2;
  const corner = rounded ? size * 0.2 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${corner}" fill="${BACKGROUND}"/>` +
    `${art.svg}</svg>`;
}

// The browser tab's icons: rounded, with the creature filling most of it.
// The gator is 15 pixels long against the hippo's 12, so it needs the wider
// square to keep its tail and snout off the edge.
writeFileSync("public/favicon.svg", `${svg(HIPPO_ART, 14.5, true)}\n`);
writeFileSync("public/favicon-gator.svg", `${svg(GATOR_ART, 16.5, true)}\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(file, pixels, size) {
  await page.setViewportSize({ width: pixels, height: pixels });
  const source = Buffer.from(svg(HIPPO_ART, size, false)).toString("base64");
  await page.setContent(
    `<html><body style="margin:0"><img src="data:image/svg+xml;base64,${source}" width="${pixels}" height="${pixels}" style="display:block;image-rendering:pixelated"></body></html>`,
  );
  await page.locator("img").screenshot({ path: file, omitBackground: false });
}
// Square and opaque: iPhones round the corners themselves, and fill a
// transparent icon with black, so the background stays and the hippo grows
// instead: it fills about 83% of the square, its ears clear of the rounding.
await png("public/apple-touch-icon.png", 180, 14.5);
await png("public/icon-192.png", 192, 14.5);
await png("public/icon-512.png", 512, 14.5);
// Android crops to a circle 80% across. The hippo's farthest corner is 8.5
// sprite pixels from its centre, so 22 keeps it inside that circle.
await png("public/icon-maskable-512.png", 512, 22);
await browser.close();
