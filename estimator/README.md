# Meal estimator sidecar

Estimates meal macros using the Grok and Claude CLIs you already pay a monthly
fee for, instead of a metered API key.

## You are not paying per token

Both CLIs run on your subscription login, not an API key. Every API key variable
is deleted from the environment before a CLI starts, so there is no path by
which this falls back to metered billing: a CLI that is not logged in fails, it
does not charge you. The startup log states which mode it is in.

The CLIs still print a `total_cost_usd` on every call. On a subscription that is
a **list-price equivalent**, not a charge — Claude labels it `costBasis: list`.
Read it as how much of your monthly allowance a call consumes, not as money.

## Why it is separate from the app

The tracker runs in a container on Linux. The CLIs are installed on your own
machine and signed in as you, so the container cannot call them. This service
sits beside the CLIs, and the app asks it over the tailnet.

Your CLI credentials never leave this machine. The app only ever sees a meal
description going out and macros coming back.

The app already speaks this protocol: it is the `GROK_GATEWAY_URL` path, which
POSTs `{"description": "..."}` with a bearer token and expects the estimate back.

## Setup

```sh
cp estimator/.env.example estimator/.env
# set ESTIMATOR_TOKEN to something long and random, and ESTIMATOR_HOST to this
# machine's tailnet IP so the container can reach it
node estimator/server.mjs
```

Then set these on the Portainer stack:

```
GROK_GATEWAY_URL=http://<this machine's tailnet IP>:8787
GROK_GATEWAY_TOKEN=<the same token>
```

Plain HTTP is accepted for private and tailnet addresses, because the tailnet
already encrypts the hop. Public hosts still have to be HTTPS.

Check it from the app: **Setup → Meal estimates → Test**. It reports whether the
estimator is reachable and which providers it will try, so "configured" and
"actually answering" are not confused.

### Start it automatically

```powershell
powershell -ExecutionPolicy Bypass -File estimator\install-windows.ps1
```

Registers a Scheduled Task that runs at logon as you, restarts on failure, and
survives being on battery. Remove it with `-Uninstall`. It refuses to install
until `.env` exists with a real token.

## Configuration

Everything can go in `estimator/.env`; a real environment variable overrides it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ESTIMATOR_TOKEN` | — | Required, 16+ characters. Must match `GROK_GATEWAY_TOKEN`. |
| `ESTIMATOR_HOST` | `127.0.0.1` | Bind address. Your tailnet IP for the container to reach it. |
| `ESTIMATOR_PORT` | `8787` | Port. |
| `ESTIMATOR_ORDER` | `claude,grok` | Providers to try, in order. |
| `GROK_BIN` / `CLAUDE_BIN` | auto | Found in the usual install paths; set to override. |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | See the warning below. |
| `ESTIMATOR_BUDGET_MS` | `40000` | Total time for all providers. |
| `ESTIMATOR_TIMEOUT_MS` | `35000` | Cap for any one provider. |
| `ESTIMATOR_RESERVE_MS` | `9000` | Time held back so the fallback still gets a turn. |

`GET /health` (bearer token required) reports the order without running anything.

## Why Claude goes first

Measured here, one estimate each:

| Provider | Model | Time | Allowance used (list-price equivalent) |
| --- | --- | --- | --- |
| Claude | `claude-haiku-5-5` | ~7 s | ~$0.0026 |
| Grok | `grok-4.7-build` | ~32 s | ~$0.0113 |
| Claude | `claude-opus-5-5` | ~8 s | ~$0.302 |

Three reasons, the third being the one that matters most:

1. Haiku is about four times lighter on your plan.
2. It is about four times faster.
3. **The fallback only fits if the fast one leads.** The app gives up after 45 s.
   Claude then Grok is about 39 s worst case and both get a turn. Grok then
   Claude leaves almost nothing for the fallback, so a slow Grok means no
   estimate at all rather than a slower one.

`ESTIMATOR_ORDER=grok,claude` reverses it if you prefer.

**Do not run Claude on Opus for this.** It is over a hundred times heavier than
Haiku for the same answer, and almost all of that is agent scaffolding sent on
every call. No money changes hands either way, but it will eat your plan limits
far faster, and hitting those is what actually stops you logging a meal.

## Could this run on the server instead?

Technically yes; in practice I would not, for three reasons.

**Credentials.** The CLIs authenticate as *you*, with full account access, not a
scope limited to meal estimates. Running them on the server means that login
living on `friend-server`, which is not your machine. Anyone with access to that
box could run agent sessions as you.

**Hardware.** That server has 3.8 GB of RAM and a disk already saturated — 54.7%
iowait when we looked, with another process stuck in uninterruptible sleep. The
CLI binaries are 293 MB (Claude) and 153 MB (Grok), and each estimate spawns one.
That is a poor fit for the slowest part of that machine, and it would compete
with everything else on it.

**It buys little.** The only thing server-side execution fixes is needing your PC
awake. Everything else — cost, speed, privacy — is better where it is.

If you do want it independent of your desktop, the honest answer is an API key,
which is the metered billing you set out to avoid.

## When it is not running

The app falls back to manual entry. The estimate button greys out, Setup says so,
and a failed call reports that the estimator did not answer rather than blaming
your description. A failure does not spend one of the 60 daily estimates.

So your machine has to be awake for estimates. That is the trade for not paying
per call.

## Notes

- API keys are stripped before each CLI runs, so a stray `ANTHROPIC_API_KEY`
  cannot silently switch you to metered billing.
- The meal description is passed as data and the system prompt says so, but treat
  the macros as an estimate to check rather than a lookup. Every number is
  editable before saving, and editing one marks the meal as your own figures.
- Each provider gets one turn with tools and web search disabled.
- A reply that would not validate counts as a failure and moves to the next
  provider, rather than reaching the app as a bad estimate.

## Running it on the server instead

The estimator can run beside the app rather than on your machine, which is the
only way estimates work when your machine is asleep. `estimator/Dockerfile`
builds an image with both CLIs inside, and the compose stack runs it as a second
service. The app reaches it at `http://estimator:8787` over the compose network,
so there is no tailnet hop, no published port, and no firewall rule.

Sign each CLI in once; the logins persist in the `estimator-config` volume:

```sh
docker exec -it athx-estimator grok
docker exec -it athx-estimator claude
```

Each prints a URL to open in your own browser. The credentials are created in
the container rather than copied from anywhere.

Worth knowing before you do this: a CLI login grants full access to that account,
not something scoped to meal estimates, and whoever administers that host can
read the volume. That is a judgement about who you trust, not a technical one.

Backups are worth running in both places, because they answer different
questions. The estimator in the stack writes to a volume of its own every twelve
hours, which covers a bad delete, a bad deploy or a corrupt database, and runs
whether or not any laptop is awake. It does not cover losing the machine: a copy
on the server it is backing up cannot survive that server. The estimator on your
own machine is the one that does, so keep it configured and run it when you can.
Neither replaces the other.

### Codex login in the container

The image also installs the Codex CLI. After the updated image has been
published and pulled, recreate the estimator through the existing Portainer
stack. A restart alone keeps the old image. Then run on the Docker host:

```sh
docker exec -it athx-estimator codex --version
docker exec -it athx-estimator codex login --device-auth
docker exec -it athx-estimator codex login status
```

Open the printed link in your own browser, sign in with your ChatGPT account,
and enter the one-time code. Enable device code login in ChatGPT security
settings if requested. This uses subscription authentication; no API key is
needed. See the [official authentication instructions](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

`CODEX_HOME=/config/.codex` keeps the login in the existing `estimator-config`
volume, owned by the same `node` user that runs the service. Keep that volume
when recreating the container. Installing and signing in to Codex does not yet
make it a meal-estimate provider: `server.mjs` currently supports only `claude`
and `grok`, so adding `codex` to `ESTIMATOR_ORDER` alone will not enable it.
