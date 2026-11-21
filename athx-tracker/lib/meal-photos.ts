/**
 * A meal's photos, as the phone sends them with an estimate. The estimator
 * holds the same limits, PHOTO_LIMIT and PHOTO_BYTES in estimator/config.mjs,
 * and a test holds the two together.
 */
export const PHOTO_LIMIT = 3;
/** The most one photo may weigh, encoded. */
export const PHOTO_BYTES = 1_000_000;
/** The same, as base64: four characters for every three bytes. */
export const PHOTO_CHARS = Math.ceil(PHOTO_BYTES / 3) * 4;
/**
 * The longest side a photo is shrunk to, in pixels, before it leaves the
 * phone. Enough to read a label by, and a fraction of what a camera takes.
 */
export const PHOTO_EDGE = 1536;
/**
 * Every photo is sent as a JPEG, whatever it was taken as. Drawing it again
 * also leaves the camera's metadata, its location included, on the phone.
 */
export const PHOTO_TYPE = "image/jpeg";
/** Tried in turn until a photo fits under PHOTO_BYTES. */
export const PHOTO_QUALITIES = [0.85, 0.7, 0.55, 0.4] as const;
/** What the estimator is told when photos come with no words. */
export const PHOTO_ONLY_DESCRIPTION = "The meal in the attached photos.";
/** Room in an estimate request for the most photos, beside its text. */
export const PHOTO_BODY_BYTES = PHOTO_LIMIT * (PHOTO_CHARS + 100);

export type MealPhoto = { type: typeof PHOTO_TYPE; data: string };

/**
 * The size to draw a photo at: its long side at most edge, its shape kept,
 * and never bigger than it came. Nothing for a photo with no size.
 */
export function fitWithin(width: number, height: number, edge = PHOTO_EDGE) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** How many bytes a padded base64 string holds. */
export function base64Bytes(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/**
 * A JPEG as padded base64, within PHOTO_BYTES. Every JPEG starts with the
 * bytes FF D8 FF, which base64 writes as "/9j/". The label a photo comes with
 * is only what the sender says it is.
 */
export function isJpegData(data: string) {
  return data.length <= PHOTO_CHARS && data.length % 4 === 0 && data.startsWith("/9j/") &&
    BASE64.test(data) && base64Bytes(data) <= PHOTO_BYTES;
}
