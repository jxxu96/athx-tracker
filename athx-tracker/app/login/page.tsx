import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COOKIE_NAME,
  configured,
  cookieOptions,
  issue,
  matches,
  signedIn,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const input = String(formData.get("passphrase") ?? "");
  if (!matches(input)) redirect("/login?error=1");

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
  searchParams: Promise<{ error?: string }>;
}) {
  if (await signedIn()) redirect("/");
  const { error } = await searchParams;
  const ready = configured();

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
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                That passphrase did not match.
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full">
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
