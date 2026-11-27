/*
 * A meal photo shrunk off the page's thread (photo-shrink.ts). Decoding a
 * camera's photo and drawing it at a fraction of its size takes a phone half
 * a second or more, and on the page's thread nothing can be tapped or typed
 * meanwhile. Drawn the same way as on the page: decoded turned the way the
 * camera was held, on white, no more than PHOTO_EDGE on its long side, and
 * the best quality that fits.
 */
import { PHOTO_BYTES, PHOTO_QUALITIES, PHOTO_TYPE, fitWithin } from "@/lib/meal-photos";

export type ShrinkAsk = { id: number; file: Blob };
/** The photo as sent, with the size it was drawn at; or why there is none. */
export type ShrinkReply =
  | { id: number; blob: Blob; width: number; height: number }
  | { id: number; tooLarge: true }
  | { id: number; error: string };

function reply(message: ShrinkReply) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<ShrinkAsk>) => {
  const { id, file } = event.data;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const size = fitWithin(bitmap.width, bitmap.height);
      if (!size) throw new Error("The photo has no size.");
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Nothing to draw the photo on.");
      // A JPEG has no transparency, so a clear part of a PNG would turn black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      for (const quality of PHOTO_QUALITIES) {
        const blob = await canvas.convertToBlob({ type: PHOTO_TYPE, quality });
        if (blob.size <= PHOTO_BYTES) return reply({ id, blob, ...size });
      }
      reply({ id, tooLarge: true });
    } finally {
      bitmap.close();
    }
  } catch (problem) {
    reply({ id, error: problem instanceof Error ? problem.message : String(problem) });
  }
};
