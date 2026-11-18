# Project instructions

## Delivery preference

- Unless the user explicitly asks otherwise, finish requested changes by testing,
  committing, pushing, opening a pull request, merging, and deploying. The user
  has authorized this workflow; do not ask again for merge or deployment approval.
- Follow the existing deployment workflow and check its result. Verify the live
  revision when reachable, and clearly report when deployment cannot be confirmed.
- Keep feature work in a Codex-managed worktree and leave the primary checkout
  on the remote default branch. Preserve all existing user work when updating it.

## Where things are

- `athx-tracker/`: the Next.js app. `app/` holds the pages and API routes.
  `components/` has a folder per tab (`today/`, `workout/` for Session, `meal/`,
  `progress/`), the shell and one-offs at its root, shared form controls in
  `form-controls.tsx`, and vendored shadcn primitives in `ui/`. `lib/` holds
  the logic, each module with its `.test.ts` beside it. `db/` and `drizzle/`
  are the schema and migrations, `e2e/` the Playwright specs.
- `athx-tracker/docs/`: what each part of the app does, one page per tab. A
  behaviour change updates its page there, not the README.
- `estimator/`: the meal-estimate sidecar. `server.mjs` is the HTTP server;
  `estimate.mjs`, `providers.mjs`, `settle.mjs`, `cli.mjs` and `prompts.mjs`
  do the estimating, `config.mjs` reads settings, and `backup.mjs` and
  `deploy-watch.mjs` are its timers.
- Deployment: `docker-compose.yml` and `.github/workflows/build.yml`. A merge to
  `main` publishes both images, and the server redeploys from them.
- Checks, from `athx-tracker/`: `npm run lint`, `npx tsc --noEmit`, `npm test`
  (app and estimator unit tests), `npm run test:e2e` (builds, then drives
  Chromium).
- `meal/meal-form.tsx`, `workout/workout-form.tsx` and `tracker.tsx` are still
  1,300 to 1,900 lines each. Put new logic in its own module rather than
  growing them.

## Answering

Be concise. Answer the question asked, not the adjacent ones.

- Lead with the answer. No preamble, no restating the question.
- Cite `file.ts:123` instead of pasting the code, unless the code *is* the point.
- One diagnostic ladder, not three. Give the most likely cause and how to
  confirm it; hold the rest until that one is ruled out.
- Drop the caveats section. Flag a caveat only where it changes what the
  reader does next.
- No closing summary of what was just said.
- Status updates get the same treatment: the outcome, then only what the reader
  cannot already see. Not the diff, not the checks that passed, not the
  workflow being followed while following it.

Uncertainty is worth stating; padding is not.
