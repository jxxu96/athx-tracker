# Hippos & Gators · ATHX 2027

A shared training and nutrition journal for two athletes working towards ATHX Lite
in New York. Self-hosted: a Next.js app in a container, with the whole journal in a
single SQLite file on a volume.

## What it does

- **Today** — countdown to the event, sessions logged this week against the weekly
  target, and fuel for each athlete. Fuel switches between today, yesterday, the
  last 7 days, and the whole journal. A single day is that day's macros against
  the daily targets. A longer range is the daily average of days that have a meal,
  so a day you forgot to log is not treated as a day you ate nothing, with the
  totals written under the bars. Total expenditure is the training burn for the
  same range, summed across both athletes. The last session, with its time and
  what it burned, and the ATHX Lite running order stay underneath.
- **Session** — log a workout as MetCon, Strength, Endurance, Solidcore, Tennis or
  Other, with Solidcore and tennis a tap away under Quick start. Load the seven
  ATHX stations with one tap, then fill in what you completed and each split.
  Elapsed time, station times, lifts and notes are all optional: a session with
  nothing timed is still a session, and reads as a dash rather than as a time of
  zero. Pairs or solo follows the switch at the top unless you set it yourself,
  and Other takes a name of its own, which is what the log then calls it.
- **Meal** — describe a meal and let Grok estimate the macros, or type them in
  yourself. Editing an estimated number saves the meal as your own figures.
  A live calorie breakdown checks protein × 4 + carbs × 4 + fat × 9 against
  the total. Differences over 10 kcal block saving; **Use macro total** fills
  the calculated calories in one tap. Automatic estimates, including queued
  meals, calculate calories from the rounded grams before returning them.
- **Log** — everything logged, newest first, filterable, with edit and delete, each
  session showing what it burned. It opens with the most recent entries and fetches
  the rest when asked, and draws a hundred at a time however many are loaded, so a
  journal years deep neither crosses the network nor reaches the screen all at once.
- **Setup** — event name and date, weekly session target, display units, each
  athlete's bodyweight, and their daily macro targets. The bodyweight is what makes
  calories burned possible; without it that figure is withheld.

### Calories burned

`estimateBurn` in `lib/domain.ts` uses the compendium formula, MET x 3.5 x kg / 200 per
minute, with METs for vigorous effort. It needs a bodyweight, which Setup holds per
athlete, and a duration, which a session logged without a time does not have. Either
missing and the figure is withheld rather than guessed, because a number that looks
measured and is not is worse than no number.

### The full-workout scenario

`projectWorkout` in `lib/domain.ts` extends a part-finished workout to the whole thing:
observed time kept as measured, only unperformed work extended at the pace you actually
held at that station, plus a fatigue allowance. A station you never started is never
given another movement's pace, and one finished but never timed has no pace to offer, so
it declines rather than guessing.

It is calculated and stored with every session but no longer shown anywhere. The two
inputs it took were being asked for while you were trying to log a session, which is the
wrong moment. Nothing was removed from the record, so it can be surfaced again without
anyone having to fill anything in.

## Running it

The stack file lives in the repository root, one level up. Point a Portainer stack at
this repository, set `APP_PASSPHRASE` in the stack environment, and deploy. The
compose file builds the image from this directory and mounts a named volume at `/data`.

Environment variables are listed in `.env.example` in the repository root. Only
`APP_PASSPHRASE` is required.

### Locally, without Docker

```sh
npm install
npm run build
APP_PASSPHRASE=some-long-passphrase npm start
```

The database is created at `./data/athx.db` unless `DATABASE_FILE` says otherwise.
`npm run dev` runs the development server the same way.

## How access works

There are no user accounts. Both athletes read and write the same records, and
`athlete` is a field on the data rather than an identity, so the only question is
whether a visitor is one of the two of you. One shared passphrase answers it.

- Signing in sets an HMAC-signed, HTTP-only cookie lasting 90 days.
- The signing key is derived from the passphrase, so changing `APP_PASSPHRASE`
  signs every device out.
- The cookie is marked `Secure` only when the request arrived over HTTPS, so the
  app still works over plain HTTP on a private network.

### Lockout

Failed sign-ins are counted in the database, in two tiers:

- **Five failures from one caller** in 15 minutes locks that caller out for 15 minutes.
- **Twenty failures across all callers** in the same window locks new sign-ins
  site-wide for 15 minutes.

The global tier is deliberately looser than the per-caller one. A hard site-wide
lock at five failures would let any passing bot lock the owners out by typing five
wrong passwords, which on a public URL would happen constantly.

Both tiers gate only *new* sign-ins. A phone that already holds a session cookie
keeps working throughout a lockout, so neither tier can shut you out of your own
journal. A correct passphrase clears both counters, and both expire on their own.

Callers are identified by `cf-connecting-ip`, `x-real-ip` or `x-forwarded-for`,
in that order. When none of those headers is present every caller shares a single
bucket, and that shared bucket is held to the looser global threshold rather than
five, so one bot cannot lock the owners out through it.

Worth checking once a new proxy is in front: if sign-ins from different devices
share a lockout, the proxy is not passing a client IP. Tailscale Funnel in
particular does not document whether it forwards one.

**Serve it over HTTPS.** The passphrase is posted in a form, and over plain HTTP on
an untrusted network it travels in the clear. On a tailnet, `tailscale serve` puts a
real certificate in front of the container for free — see `tailscale serve --help`
for the syntax your version uses. Do not expose the container directly to the
internet without TLS in front of it.

## Database and backups

One SQLite file holds everything. Migrations in `drizzle/` run automatically on first
use, so a fresh volume comes up with its tables already built.

Backing up is copying that file, ideally with the container stopped so the
write-ahead log is checkpointed. The estimator also pulls a copy on a timer when
`BACKUP_URL` and `BACKUP_PASSPHRASE` are set; see its README for where those
copies land and what they do and do not protect against. After changing `db/schema.ts`, run `npm run db:generate`
and commit the generated SQL; the new migration applies itself on the next start.

## Meal estimates

Macro estimates call Grok and are optional; without them the macro fields are typed in
by hand, and Setup says which mode is active. Set `XAI_API_KEY` (and optionally
`XAI_MODEL`), or point `GROK_GATEWAY_URL` and `GROK_GATEWAY_TOKEN` at a gateway.
Estimates are capped at 60 a day, counted in the database so a restart cannot reset it.
