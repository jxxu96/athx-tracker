/**
 * What a paste (Ctrl+V or ⌘V) adds to a meal's photos. The browser hands a
 * paste its clipboard: the kinds of data on it, and any files, which hold a
 * screenshot, a picture copied from a page or Photos, or a picture file
 * copied in File Explorer or Finder. Unlike the Paste button, a paste needs
 * no permission and carries copied files too.
 */
export type Pasted<T extends { type: string }> = { types: readonly string[]; files: readonly T[] };

/**
 * The pictures a paste should add, or none. Pasted into a box that takes
 * typing, text wins: Word, Excel and OneNote put a picture of what was copied
 * on the clipboard beside its text, and that is not a photo of a meal. A
 * picture copied from a page has no plain text with it, so it still comes in.
 */
export function picturesIn<T extends { type: string }>(pasted: Pasted<T>, intoText: boolean): T[] {
  if (intoText && pasted.types.includes("text/plain")) return [];
  return pasted.files.filter((file) => file.type.startsWith("image/"));
}
