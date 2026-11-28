/** What a browser tells a page about the device it runs on. */
export type Device = { userAgent: string; platform?: string; maxTouchPoints?: number };

/**
 * Whether a photo picker on this device goes through iOS's own menu of
 * library, camera and files, which Safari puts in front of any file input
 * that is not the camera's, and which no page can skip. There, a Library
 * button opens the same menu as File, so only File is offered.
 *
 * An iPhone, iPod or iPad says so, in Chrome and Firefox for iOS too. An
 * iPad asking for desktop pages, as its Safari does by default, calls itself
 * a Mac, and is told apart from one by its touch screen: a Mac reports none.
 */
export function goesThroughIosMenu({ userAgent, platform = "", maxTouchPoints = 0 }: Device) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Mac/.test(platform || userAgent) && maxTouchPoints > 1;
}
