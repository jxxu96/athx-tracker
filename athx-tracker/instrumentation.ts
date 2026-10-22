export async function register() {
  // Node runtime only: the worker uses SQLite and must not run on the edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startQueueWorker } = await import("./lib/queue");
  startQueueWorker();
}
