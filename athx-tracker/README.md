# Hippos & Gators · ATHX 2027

A shared training and nutrition journal for two athletes working towards ATHX Lite
in New York. Self-hosted: a Next.js app in a container, with the whole journal in a
single SQLite file on a volume.

## What it does

One page per part of the app, in [`docs/`](docs/). Each says what the screen
does and points at the code that does it.

- [Today](docs/today.md): fuel, energy, each zone's progress, the race-day
  estimate, the running order and the days trained.
- [Session](docs/session.md): logging a workout.
- [Meal](docs/meal.md): describing a meal, estimating or typing its macros,
  templates, items and dishes.
- [Meal estimates and drafts](docs/meal-estimates.md): how an estimate runs,
  and what is kept while a form is open.
- [Progress](docs/progress.md): the main lifts at the rep max the race asks for,
  the ATHX benchmarks and the weekly review.
- [Log and Setup](docs/log-and-setup.md): everything logged, the settings, and
  the header.
- [How the figures are worked out](docs/figures.md): weights and older entries,
  calories burned, the full-workout scenario, resting energy and the balance.
- [Race day](docs/race.md): the race-day estimate and the running order.
- [Without a connection](docs/offline.md): saves that wait on the phone.

## Running it

The stack file lives in the repository root, one level up. Point a Portainer stack at
this repository, set `APP_PASSPHRASE` in the stack environment, and deploy. The
compose file pulls the image GitHub Actions builds from this directory, and mounts a
named volume at `/data`.

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
