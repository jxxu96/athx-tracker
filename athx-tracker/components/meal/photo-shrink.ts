import { PHOTO_BYTES, PHOTO_QUALITIES, PHOTO_TYPE, fitWithin, type MealPhoto } from "@/lib/meal-photos";
import type { ShrinkReply } from "./photo-shrink.worker";

/** A photo as it is sent, and the JPEG it was read from, to show it by. */
export type ShrunkPhoto = MealPhoto & { blob: Blob };

/**
 * A 2×1 JPEG marked to be turned a quarter clockwise (EXIF orientation 6),
 * so 1×2 once turned. A browser whose worker does not turn it would send a
 * phone photo on its side; the page shrinks photos itself in that browser.
 */
const TURNED_PROBE =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI" +
  "////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////" +
  "////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QA" +
  "FAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALQAf//Z";

/** Long enough for the worker to load on a slow phone; past it, the page shrinks photos itself. */
const PROBE_MS = 5_000;
/** The largest photo on a slow phone, with room to spare; past it, the page tries it itself. */
const SHRINK_MS = 30_000;

let worker: Worker | null = null;
let usable: Promise<boolean> | null = null;
let asked = 0;
const waiting = new Map<number, (reply: ShrinkReply | null) => void>();

/** The worker is gone: whatever it had is tried on the page, and so is everything after. */
function dropWorker() {
  worker?.terminate();
  worker = null;
  usable = Promise.resolve(false);
  for (const answer of waiting.values()) answer(null);
  waiting.clear();
}

/** The worker's answer for one file, or null when it gave none in time. */
function ask(file: Blob, timeout: number) {
  const running = worker;
  if (!running) return Promise.resolve(null);
  const id = ++asked;
  return new Promise<ShrinkReply | null>((resolve) => {
    const timer = setTimeout(() => answer(null), timeout);
    function answer(reply: ShrinkReply | null) {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(reply);
    }
    waiting.set(id, answer);
    running.postMessage({ id, file });
  });
}

/**
 * Whether this browser can shrink photos in a worker, turned as the page
 * would turn them. Asked once, with the probe through the whole of it.
 */
function workerUsable() {
  usable ??= (async () => {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined") return false;
    try {
      worker = new Worker(new URL("./photo-shrink.worker.ts", import.meta.url));
    } catch {
      return false;
    }
    worker.onmessage = (event: MessageEvent<ShrinkReply>) => waiting.get(event.data.id)?.(event.data);
    worker.onerror = dropWorker;
    worker.onmessageerror = dropWorker;
    const probe = Uint8Array.from(atob(TURNED_PROBE), (char) => char.charCodeAt(0));
    const reply = await ask(new Blob([probe], { type: PHOTO_TYPE }), PROBE_MS);
    if (reply && "blob" in reply && reply.width === 1 && reply.height === 2) return true;
    dropWorker();
    return false;
  })();
  return usable;
}

/** A blob as base64: what follows the comma of its data URL. */
function base64Of(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * A photo as it is sent. The browser decodes it, turned the way the camera
 * was held, and it is drawn at no more than PHOTO_EDGE on its long side, then
 * encoded as a JPEG small enough to send, at the best quality that fits.
 * Drawn again, it leaves its metadata, the location included, on the phone.
 * A format this browser cannot open fails here.
 *
 * In a worker where the browser has one that turns photos, so the page goes
 * on answering taps and typing meanwhile. A photo the worker cannot open, in
 * a format only the page decodes, is tried on the page.
 */
export async function shrink(file: File): Promise<ShrunkPhoto> {
  if (await workerUsable()) {
    const reply = await ask(file, SHRINK_MS);
    if (reply && "blob" in reply) return { type: PHOTO_TYPE, data: await base64Of(reply.blob), blob: reply.blob };
    if (reply && "tooLarge" in reply) throw new Error("The photo is too large to send.");
  }
  return shrinkHere(file);
}

/** The same on the page's own thread, which nothing else can use while it works. */
async function shrinkHere(file: File): Promise<ShrunkPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = fitWithin(image.naturalWidth, image.naturalHeight);
    if (!size) throw new Error("The photo has no size.");
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nothing to draw the photo on.");
    // A JPEG has no transparency, so a clear part of a PNG would turn black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    for (const quality of PHOTO_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PHOTO_TYPE, quality));
      if (blob && blob.size <= PHOTO_BYTES) return { type: PHOTO_TYPE, data: await base64Of(blob), blob };
    }
    throw new Error("The photo is too large to send.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
