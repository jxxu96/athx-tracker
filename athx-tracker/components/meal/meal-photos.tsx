"use client";

import { useState } from "react";
import { Camera, ClipboardPaste, File as FileIcon, X } from "lucide-react";
import { ApplePhotosMark, GooglePhotosMark } from "@/components/meal/photo-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, newId } from "@/lib/client";
import {
  PHOTO_BYTES,
  PHOTO_LIMIT,
  PHOTO_QUALITIES,
  PHOTO_TYPE,
  fitWithin,
  type MealPhoto,
} from "@/lib/meal-photos";
import { cn } from "@/lib/utils";

/** A photo on the form, with a key to list it by. */
export type HeldPhoto = MealPhoto & { id: string };

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
 */
async function shrink(file: File): Promise<MealPhoto> {
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
      if (blob && blob.size <= PHOTO_BYTES) return { type: PHOTO_TYPE, data: await base64Of(blob) };
    }
    throw new Error("The photo is too large to send.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The photos on a meal form. They stay with the form while it is open and go
 * with every estimate from it, a reply included. They are not kept in its
 * draft, which lives in this phone's storage and would not hold many, and the
 * meal is saved without them. A meal saved to be estimated in the background
 * sends them ahead of it (`sendForLater`), and the server deletes them once
 * it has been estimated.
 */
export function useMealPhotos() {
  const [photos, setPhotos] = useState<HeldPhoto[]>([]);
  // How many photos are being read, so the form can say so.
  const [readingCount, setReadingCount] = useState(0);
  const [error, setError] = useState("");

  async function add(files: readonly File[]) {
    const taken = files.slice(0, Math.max(0, PHOTO_LIMIT - photos.length));
    setError("");
    if (!taken.length) return;
    setReadingCount(taken.length);
    const made: HeldPhoto[] = [];
    for (const file of taken) {
      try {
        made.push({ id: newId(), ...(await shrink(file)) });
      } catch {
        // Said below, once, for however many could not be opened.
      }
    }
    setPhotos((current) => [...current, ...made].slice(0, PHOTO_LIMIT));
    setReadingCount(0);
    if (made.length < taken.length)
      setError(taken.length === 1
        ? "That photo could not be opened here. Try another, or a JPEG or PNG."
        : `${taken.length - made.length} of those photos could not be opened here. Try others, or JPEGs or PNGs.`);
    else if (files.length > taken.length)
      setError(`An estimate takes ${PHOTO_LIMIT} photos at most, so the rest were left out.`);
  }

  /**
   * Pictures copied to the clipboard, from Photos or a page. The browser asks
   * first: Safari shows its own Paste button to tap, and Chrome asks once to
   * allow it. Safari reads only from the tap itself, so nothing is awaited
   * before the clipboard is asked.
   */
  async function paste() {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.read) {
      setError("This browser does not let the page read the clipboard. Use Library or File instead.");
      return;
    }
    let items: ClipboardItem[];
    try {
      items = await clipboard.read();
    } catch {
      setError("The clipboard was not read. Allow pasting when the browser asks, or use Library or File.");
      return;
    }
    const files: File[] = [];
    for (const item of items) {
      const type = item.types.find((kind) => kind.startsWith("image/"));
      if (!type) continue;
      try {
        files.push(new File([await item.getType(type)], "pasted", { type }));
      } catch {
        // Listed and then not given: the same as no picture.
      }
    }
    if (!files.length) {
      setError("There is no picture on the clipboard. Copy a photo first, then paste it here.");
      return;
    }
    await add(files);
  }

  function remove(id: string) {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    setError("");
  }

  function clear() {
    setPhotos([]);
    setError("");
  }

  /** What an estimate sends: the photos alone, without their keys. */
  const sent: MealPhoto[] = photos.map(({ type, data }) => ({ type, data }));
  return { photos, sent, reading: readingCount > 0, readingCount, error, add, paste, remove, clear };
}

/** An upload of six photos on a slow phone connection, and no longer. */
const SEND_TIMEOUT_MS = 60_000;

/**
 * Sends a meal's photos ahead of it when it is saved to be estimated in the
 * background, with the ids of the records that will point to them, and gives
 * the id they point to them by. The server keeps them until each of those
 * records has arrived and been estimated. Unlike the meal, they cannot wait
 * on the phone for a connection: storage there would not hold them, so this
 * fails without one.
 */
export async function sendForLater(photos: MealPhoto[], meals: string[]) {
  const id = newId();
  await api<{ ok: true }>("/api/queued-photos", {
    method: "POST",
    body: JSON.stringify({ id, images: photos, meals }),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined,
  });
  return id;
}

export type MealPhotoState = ReturnType<typeof useMealPhotos>;

/**
 * Take photo opens the camera on a phone: capture asks for a new picture, and
 * the phone's own camera takes it, so the page never reaches the camera
 * itself. Library picks photos, File any file, and Paste a picture copied to
 * the clipboard. Which picker opens is the browser's choice: Android gives
 * the photo picker for Library and its file browser for File, while iOS
 * shows one menu of library, camera and files for both, which no page can
 * skip or trim. Paste is the way round it there: Copy in Photos, then Paste.
 * Each picker is a label around its file input, the way a picker opens on
 * every browser, Safari's included, without a script clicking a hidden input.
 */
export function MealPhotos({ state, disabled = false, held = false }: {
  state: MealPhotoState;
  disabled?: boolean;
  /** A meal waiting for its background estimate, whose photos are on the server. */
  held?: boolean;
}) {
  const { photos, reading, readingCount, error, add, paste, remove } = state;
  const off = disabled || reading || photos.length >= PHOTO_LIMIT;
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared, so picking the same photo again is still a change.
    event.target.value = "";
    if (files.length) void add(files);
  };
  const choice = cn(
    buttonVariants({ variant: "outline" }),
    "relative cursor-pointer has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50",
    "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className={choice}>
          <Camera />
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={off}
            onChange={pick}
          />
        </label>
        <label className={choice}>
          <span className="flex items-center -space-x-1" aria-hidden="true">
            <GooglePhotosMark className="size-4" />
            <ApplePhotosMark className="size-4" />
          </span>
          Library
          <input type="file" accept="image/*" multiple className="sr-only" disabled={off} onChange={pick} />
        </label>
        {/* No image filter, so a browser that has one offers its file browser
            rather than the photo picker. Anything that is not a picture it can
            open is turned away as unreadable. */}
        <label className={choice}>
          <FileIcon />
          File
          <input type="file" multiple className="sr-only" disabled={off} onChange={pick} />
        </label>
        <Button type="button" variant="outline" disabled={off} onClick={() => void paste()}>
          <ClipboardPaste />
          Paste
        </Button>
      </div>
      {photos.length ? (
        <ul aria-label="Meal photos" className="flex flex-wrap gap-2.5 pt-1">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              {/* A data URL made on this phone: there is nothing for next/image to fetch or resize. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${photo.type};base64,${photo.data}`}
                alt={`Meal photo ${index + 1}`}
                className="size-20 rounded-lg border object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`Remove photo ${index + 1}`}
                className="absolute -top-1.5 -right-1.5 rounded-full border shadow-xs"
                disabled={disabled}
                onClick={() => remove(photo.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {reading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {readingCount === 1 ? "Reading the photo…" : `Reading ${readingCount} photos…`}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {held && !photos.length ? (
        <p className="text-[11px] text-muted-foreground">
          Its photos are on the server, waiting for the background estimate. Saved to estimate in the
          background again, it keeps them; photos added here replace them.
        </p>
      ) : null}
      {photos.length ? (
        <p className="text-[11px] text-muted-foreground">
          Up to {PHOTO_LIMIT} photos: another angle, a label or the menu helps, and food seen twice counts
          once. Sent with each estimate and not kept: the meal saves its figures and what the estimate saw.
          Saved to estimate in the background, they wait on the server until it is done.
        </p>
      ) : null}
    </div>
  );
}
