import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COOKIE_NAME,
  clearFailures,
  clientKey,
  configured,
  cookieOptions,
  issue,
  lockedFor,
  matches,
  recordFailure,
  signedIn,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function waitText(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}

async function signIn(formData: FormData) {
  "use server";
  const client = await clientKey();

  const waiting = lockedFor(client);
  if (waiting > 0) redirect(`/login?locked=${waiting}`);

  if (!matches(String(formData.get("passphrase") ?? ""))) {
    const locked = recordFailure(client);
    // A deliberate pause: cheap for a person, expensive for a script.
    await new Promise((resolve) => setTimeout(resolve, 400));
    redirect(locked > 0 ? `/login?locked=${locked}` : "/login?error=1");
  }

  clearFailures(client);

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-proto");
  const secure = (forwarded ?? "").split(",")[0].trim() === "https";

  const jar = await cookies();
  jar.set(COOKIE_NAME, issue(), cookieOptions(secure));
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; locked?: string }>;
}) {
  if (await signedIn()) redirect("/");
  const { error, locked } = await searchParams;
  const ready = configured();
  const waiting = Number(locked) > 0 ? Number(locked) : 0;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Hippos &amp; Gators
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your shared ATHX Lite journal.
        </p>

        {ready ? (
          <form action={signIn} className="mt-6 space-y-3">
            <div>
              <Label
                htmlFor="passphrase"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Passphrase
              </Label>
              <Input
                id="passphrase"
                name="passphrase"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                disabled={waiting > 0}
              />
            </div>
            {waiting > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                Too many attempts. Try again in {waitText(waiting)}. Devices
                already signed in are unaffected.
              </p>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                That passphrase did not match.
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={waiting > 0}>
              Open journal
            </Button>
          </form>
        ) : (
          <div className="mt-6 rounded-2xl border bg-card p-4 text-sm">
            <p className="font-medium">Not set up yet</p>
            <p className="mt-1 text-muted-foreground">
              Set <code className="font-mono">APP_PASSPHRASE</code> on the
              container and restart it. Until then nobody can sign in.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
