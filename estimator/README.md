# Meal estimator sidecar

Estimates meal macros using the Grok and Claude CLIs you already pay a monthly
fee for, instead of a metered API key.

## Why it is separate

The tracker runs in a container on Linux. The CLIs are installed on your own
machine and signed in as you, so the container cannot call them. This small
service sits on your machine, and the app asks it over the tailnet.

Your CLI credentials never leave this machine. The app only ever sees a meal
description going out and macros coming back.

The app already speaks this protocol: it is the `GROK_GATEWAY_URL` path, which
POSTs `{"description": "..."}` with a bearer token and expects the estimate back.
Nothing in the app needed changing to support it.

## Running it

```sh
ESTIMATOR_TOKEN=<a long random string> \
ESTIMATOR_HOST=100.109.37.14 \
GROK_BIN="C:/Users/<you>/.grok/bin/grok.exe" \
CLAUDE_BIN="C:/Users/<you>/.local/bin/claude.exe" \
node estimator/server.mjs
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `ESTIMATOR_TOKEN` | — | Required, 16+ characters. Must match `GROK_GATEWAY_TOKEN` on the stack. |
| `ESTIMATOR_HOST` | `127.0.0.1` | Bind address. Use your tailnet IP so the container can reach it. |
| `ESTIMATOR_PORT` | `8787` | Port to listen on. |
| `ESTIMATOR_ORDER` | `grok,claude` | Providers to try, in order. |
| `GROK_BIN` / `CLAUDE_BIN` | — | Full path to each CLI. Omit one to disable it. |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | See the cost note below before changing this. |
| `ESTIMATOR_TIMEOUT_MS` | `90000` | Per-provider timeout. |

`GET /health` returns the provider order without running anything.

Then set these on the Portainer stack so the app points at it:

```
GROK_GATEWAY_URL=http://100.109.37.14:8787
GROK_GATEWAY_TOKEN=<the same token>
```

Plain HTTP is accepted for private and tailnet addresses, because the tailnet
already encrypts the hop. Public hosts still have to be HTTPS.

## Which provider to put first

Measured on this machine, one estimate each:

| Provider | Model | Time | Reported cost |
| --- | --- | --- | --- |
| Claude | `claude-haiku-5-5` | ~7 s | ~$0.0026 |
| Grok | `grok-4.7-build` | ~32 s | ~$0.0113 |
| Claude | `claude-opus-5-5` | ~8 s | ~$0.302 |

The default order is `grok,claude`. On these numbers Claude on Haiku is about
four times cheaper and four times faster for the same answer, so
`ESTIMATOR_ORDER=claude,grok` is probably the better default. Both gave
sensible macros with their assumptions spelled out.

**Do not run Claude on Opus for this.** It costs over a hundred times more than
Haiku and gives the same answer; the difference is almost entirely the agent
scaffolding sent on every call.

Those figures are what the CLIs report. Whether they are billed or merely
notional depends on your plan.

## What happens when it is not running

The app falls back to manual entry. The Meal screen already handles this: the
estimate button is disabled and it says Grok is not connected. Nothing breaks,
and nothing is lost but the convenience.

This means your machine has to be awake for estimates to work. That is the
trade for not paying per call.

## Notes

- API keys are stripped from the environment before each CLI runs, so a stray
  `ANTHROPIC_API_KEY` cannot silently switch you to metered billing.
- The meal description is passed as data, and the system prompt says so, but
  treat the macros as an estimate to check rather than a lookup. You can edit
  every number before saving, and editing one marks the meal as your own figures.
- Each provider is given one turn with tools and web search disabled.
