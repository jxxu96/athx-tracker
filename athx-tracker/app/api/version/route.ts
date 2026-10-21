// Public on purpose and deliberately dull: the commit it was built from and
// when this container started. Without it there is no way to tell which code a
// deployment is actually running without signing in and looking for a feature.
const STARTED_AT = new Date().toISOString();

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      commit: (process.env.BUILD_SHA ?? "unknown").slice(0, 12),
      startedAt: STARTED_AT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
