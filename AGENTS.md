# Project instructions

## Delivery preference

- Unless the user explicitly asks otherwise, finish requested changes by testing,
  committing, pushing, opening a pull request, merging, and deploying. The user
  has authorized this workflow; do not ask again for merge or deployment approval.
- Follow the existing deployment workflow and check its result. Verify the live
  revision when reachable, and clearly report when deployment cannot be confirmed.
- Keep feature work in a Codex-managed worktree and leave the primary checkout
  on the remote default branch. Preserve all existing user work when updating it.

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
