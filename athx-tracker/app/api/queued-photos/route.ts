import { BodyTooLarge, MAX_BODY_BYTES, database, guard, json, readBody, tooLarge } from "@/lib/server";
import { PHOTO_BODY_BYTES } from "@/lib/meal-photos";
import { holdPhotos } from "@/lib/queued-photos";
import { queuedPhotosSchema } from "@/lib/validation";

/**
 * A meal's photos, sent just before the meal is saved to be estimated in the
 * background. The meal points to them by this id, and they are kept only
 * until it has been estimated (`lib/queued-photos.ts`).
 */
export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  try {
    const { id, images } = queuedPhotosSchema.parse(
      await readBody(request, MAX_BODY_BYTES + PHOTO_BODY_BYTES),
    );
    holdPhotos(database(), id, images);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json({ error: "Each photo must be a JPEG of at most 1 MB, and six at most." }, 400);
  }
}
