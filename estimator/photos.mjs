/** A meal's photos: which ones a request may carry, and where a CLI finds them. */
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PHOTO_BYTES, PHOTO_CHARS, PHOTO_LIMIT } from "./config.mjs";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const UNUSABLE = "Each photo must be a JPEG, sent as base64, of at most 1 MB.";

/**
 * The photos a meal request carries, or why they cannot be used. JPEG only:
 * the phone re-encodes every photo it sends, which also leaves the camera's
 * metadata, its location included, on the phone. A photo is checked by its
 * first bytes as well as its label, since the label is only what the caller
 * says it is. Absent is no photos.
 */
export function readPhotos(value) {
  if (value === undefined) return { photos: [] };
  if (!Array.isArray(value) || !value.length || value.length > PHOTO_LIMIT)
    return { error: `Send from 1 to ${PHOTO_LIMIT} photos.` };
  const photos = [];
  for (const photo of value) {
    const data = photo && typeof photo === "object" ? photo.data : undefined;
    if (photo?.type !== "image/jpeg" || typeof data !== "string" || data.length > PHOTO_CHARS
      || data.length % 4 !== 0 || !BASE64.test(data))
      return { error: UNUSABLE };
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
      return { error: UNUSABLE };
    photos.push({ type: "image/jpeg", data });
  }
  return { photos };
}

/**
 * Each photo as a file of its own, for a CLI that takes a path, in a folder no
 * other estimate uses. images is the same photos as base64, for a CLI that is
 * handed them in its input instead. remove() takes the folder away, once every
 * CLI that was asked has exited.
 */
export function writePhotos(photos) {
  const folder = join(tmpdir(), `athx-estimator-photos-${randomBytes(6).toString("hex")}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const files = photos.map((photo, index) => {
    const file = join(folder, `photo-${index + 1}.jpg`);
    writeFileSync(file, Buffer.from(photo.data, "base64"), { mode: 0o600 });
    return file;
  });
  return {
    folder,
    files,
    images: photos.map(({ type, data }) => ({ type, data })),
    remove() {
      try {
        rmSync(folder, { recursive: true, force: true });
      } catch {
        // The answer is already in hand. A temp folder left behind is not it.
      }
    },
  };
}
