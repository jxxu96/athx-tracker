/*
 * Opens the journal without a connection: the last copy of the page the
 * server sent, and the built files it runs on. Nothing else is stored here.
 * Saves and deletes made without a connection wait in the app itself, which
 * sends them once the server answers.
 *
 * The page registers this with its build in the query, so every deploy is a
 * new worker with its own store, and the old store goes with the old worker.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STORE = `athx-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("athx-") && key !== STORE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Only the journal itself: a redirect to sign in is not a page to open later. */
function keepable(response) {
  return response.ok && response.type === "basic" && !response.redirected;
}

async function keep(request, response) {
  if (!keepable(response)) return;
  const store = await caches.open(STORE);
  await store.put(request, response);
}

/*
 * The page sends the files it loaded before this worker was running, so the
 * first visit already leaves enough behind to open offline.
 */
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "keep" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    Promise.all(
      event.data.urls.map(async (href) => {
        const url = new URL(href, self.location.origin);
        if (url.origin !== self.location.origin) return;
        if (url.pathname !== "/" && !url.pathname.startsWith("/_next/static/")) return;
        const key = url.pathname === "/" ? "/" : url.href;
        if (url.pathname !== "/" && (await caches.match(key, { cacheName: STORE }))) return;
        try {
          await keep(key, await fetch(url.href, { credentials: "same-origin" }));
        } catch {
          // Offline already, or the server turned it away; the next visit tries again.
        }
      }),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The journal: from the network whenever there is one, so it is never
  // stale with a connection, and the last copy when there is not.
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(keep("/", response.clone()));
          return response;
        })
        .catch(async () => (await caches.match("/", { cacheName: STORE })) || Response.error()),
    );
    return;
  }

  // Built files never change under their names, so a stored one is the file.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request, { cacheName: STORE }).then(
        (stored) =>
          stored ||
          fetch(request).then((response) => {
            event.waitUntil(keep(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
