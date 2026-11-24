# Meal estimates and drafts

Macro estimates call Grok and are optional; without them the macro fields are typed in
by hand, and Setup says which mode is active. Set `XAI_API_KEY` (and optionally
`XAI_MODEL`), or point `GROK_GATEWAY_URL` and `GROK_GATEWAY_TOKEN` at a gateway.
Estimates are capped at 60 a day, counted in the database so a restart cannot reset it.

After estimating, review how each estimator reached its figures under
**Answers so far**. That is the only place it is shown: the assumptions box
would repeat it, so it is left out while those answers are on the form, and
appears for a meal without them, such as one reopened from the Log, a
template, or a single answer. **Reply to
estimate** stays either way, and opens a conversation where you can correct portions or ingredients,
or ask how the figures were reached. Each reply includes your earlier
clarifications and updates the meal's macros and assumptions. Failed replies
keep the current estimate and the text you were typing.

Meal and Session drafts stay open when you switch sections, including while AI
is processing. If an estimate finishes while you are elsewhere, a small popup
offers to take you back to review it. Failed estimates also notify you and keep
the description for retry. Nothing reaches the journal until you choose to save
the form.

Several meals can be estimated at once. **New meal** stays available while an
estimate runs: the meal on the form is set aside, listed in Drafts as
"Estimating…", and its form stays mounted out of sight until the answer is in,
which lands on that meal and no other. Opening another draft, or editing an
entry from the Log, sets it aside the same way. Each answer raises its own
popup, naming the meal, unless that meal is on screen; **View meal** opens it.
Once its answer is kept in its draft, a meal set aside is an ordinary draft
again. Stop still ends an estimate, and so does closing the app or reloading
it, since the request belongs to the page: the draft keeps the description and
any answers in so far.

While a meal estimate runs, each estimator's figures appear under **Answers so
far** as it answers. They are shown, not applied: the meal waits for the
settled answer, which averages them by weight and confidence: a label counts
double and a low-confidence answer half, and when two found the label a low
one is left out. Switching an answer on or off, and its weight, are under
**Estimator weights**.
**Stop estimate** ends it, stops the estimator's CLIs, gives the daily
estimate back, and unlocks the form to edit. A stopped estimate raises no
popup.

Once it has settled, **Estimator weights** at the very top of the form lists
each estimator's macros alone, whether it counts, and a slider from 0 to 100
for its weight, with the share the average gives it and the weighted
average underneath. That share is the weight times the answer's confidence.
Each figure can be typed over, and the meal is averaged
again from it; an answer typed over is marked as edited, and a meal averaged
from one is saved as your own numbers. When two found the label, a low answer
starts left out and can be switched back on. Moving a slider reweighs the meal at
once, and the weight is this phone's default for the next meal. A meal split
by dish is settled by the estimator dish by dish, with its own fixed weights,
so it shows none.

**Save and estimate in background** saves the meal now, with zero macros and
the description kept, and the server estimates it with the same estimators and
the same settling, with nobody waiting on it. Pressed mid-estimate, it takes
over from the one on screen. The server starts within a few seconds of the
save rather than at its two-minute retry timer, and a meal logged for both
athletes is estimated once and both records are filled with the same figures.
While one is waiting, the app looks for its figures every 15 seconds, and a
popup says when they arrive, from whichever section is open. It is offered
for a meal that is not split by dish, which the queue cannot fill, and
until there is an estimate on the form, since a queued meal would throw those
figures away. A meal with photos is queued with them; see [Photos](#photos). Background estimates do not count toward the 60 a day. They
need the estimator: with only `XAI_API_KEY` set, the button is not offered,
since the worker asks the gateway and nothing else.

## Photos

A meal's photos go with its estimate as JPEGs, six at most and 1 MB each,
so a request with photos can reach about 8.1 MB.
The app and the estimator both check each one by its first bytes as well as
its label. The estimator writes each to a folder of its own for the
estimate and removes it once every estimator asked has exited. Codex is
given each photo by its path, and Claude reads them in its first message,
ahead of the words. Grok's CLI is not asked about a meal with photos, since
no way to hand it an image was found, and the list of estimators that did
not answer says so: "not asked: it cannot read photos". With only
`XAI_API_KEY` set, the x.ai API is sent the photos itself.

A meal with photos asks everyone who can see them at once, as a complex
meal does, so a portion judged from a photo is the average of each view of
it rather than the first one in. It shares no looked-up labels between them
and is never kept in the label cache, since the words alone do not say what
a photo showed. An estimator older than the app does not say it took the
photos, and the app does not use what it answers, which would be for the
words alone: it says the estimator needs updating, and the estimate is not
counted. One that hangs up on a request that size reads as one that did not
answer, and the notice says it may be older than the app.

A meal saved to be estimated in the background sends its photos first, to
`/api/queued-photos`, under an id the phone makes; the meal's `photoSet` is
that id. They wait in their own table, `queued_photos`, not in the meal's
record, which every phone fetches and every backup copies. The worker sends
them with the meal's words, or with "The meal in the attached photos." when
there are none, and keeps the answer only from an estimator that says it
took them all, as the form does; from one that does not, the meal waits.
Meals are estimated once per description and set of photos, so a meal for
both is asked once and two meals of photos alone are not taken for one. The
photos are deleted once no meal waiting for its estimate points to them: when
it is filled, when an edit drops them, or when it is deleted, the other
athlete's half of it waiting on them still. Photos no meal took within a day,
because the meal was never sent, are deleted at the worker's next turn, and
a meal that arrives after them is estimated from its words alone, or waits
when it has none (`lib/queued-photos.ts`).

## When Claude's sign-in runs out

A Claude login on the estimator has a time limit, and past it the CLI cannot
renew it: every Claude estimate fails until someone signs in again where the
estimator runs (`docker exec -it athx-estimator claude auth login` in the
stack). The app warns ahead of it with a popup 7 days, 3 days, 2 days, 1 day
and 12 hours before the end the estimator reports. It names when the login
ends, gives the command, and goes with one click: **Got it**, the close
button, Escape or a tap outside. Each warning is sent away on that phone
only, and the next one comes back on its own. A phone not opened for a while
gets only the warning due now, and past the end the last one is shown once.
Signing in again gives a new end, which starts its warnings afresh.

The end is the `loginExpiresAt` that `claude auth status` reports, which the
CLI treats as the latest the sign-in lasts: it says it can end up to three
days sooner, so the popup gives both dates. The app asks when it opens, every
hour while open, and on coming back to it, at most once in ten minutes
(`components/login-expiry-alert.tsx`, `lib/login-expiry.ts`). There is no
popup without an estimator of your own, when the estimator is not reachable
or is older than this, or for a login with no end on record, such as a
`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.

## Drafts

What is typed into the Meal or Session form is kept on the phone as it is
typed (`lib/drafts.ts`, `hooks/use-form-draft.ts`), so the app being closed, the
phone dropping it from memory, or a reload loses none of it: opening the form
again opens it as it was left, an unsaved edit of an entry included, which says
"unsaved changes restored". A form that is opened and not typed in keeps no
draft, and neither does one typed in and emptied again. A meal's photos are
not part of its draft: they stay with the form while it is open, and a
reload or a draft opened again has none.

**New meal** or **New session** above a form with a draft sets it aside and
starts a fresh one; **Discard draft** throws it away. Drafts set aside are
listed at the top of their tab, newest first, with who they are for and when
they were last typed into. Tapping one opens it on the form, and the one that
was open joins the list. Saving the form deletes its draft, Cancel on an edit
deletes that edit's draft, and deleting an entry in the Log deletes any unsaved
edit of it. Drafts belong to the phone they were typed on and are not sent to
the server. A draft the form cannot open, as one saved by an older version of
the form could be, is removed with a notice rather than breaking the app.

Browser tabs on one phone share the drafts, and each has its own form open.
A reload opens what that tab had; a tab the app was just opened in opens what
was left in any, unless another tab has it open, when it starts afresh. A
draft is only ever on one form: the tab that has it holds it
(`lib/draft-locks.ts`), and every other tab lists it as "Open in another tab",
neither opening nor deleting it until that tab has moved on from it or
closed. Two
tabs typing into one draft would overwrite each other, and since a draft
carries the ids its meal is saved under, the second save would replace the
first meal. Holding uses Web Locks, which the browser lets go of when a tab
closes or crashes. They exist only over HTTPS and on localhost, so reached
over plain HTTP the tabs are not kept apart. A change to the drafts starts
from what storage holds then, so one tab never writes an older copy over
another's typing.

**Food notes** in Setup are a shared list of foods you eat often: a usual
order, which product a word means ("yogurt" is Fage Total 0% plain), or its
label figures. The server adds them to every meal estimate, first estimates,
replies and queued meals alike, and the estimator uses a note only for an item
the meal mentions, preferring it to a search or a reference value and naming it
in the assumptions. They are capped at 2,000 characters so the largest reply
still fits the estimator's request limit. An older estimator still receives
the notes, but without the instruction that says how to use them.

The conversation stays with the open draft. Saving keeps the final macros and
assumptions; reopening a saved meal, or tapping a template or a repeated meal,
lets you start from those values. Edit a template to rename it or to change
the foods and the grams. Those portions are what the next estimate reads.
Saving Setup keeps the templates. A fresh **Estimate macros** starts a new conversation. Each
successful reply counts toward the daily estimate limit. Replies carry more
context than a first estimate, so an estimator running on your own machine has
to be updated along with the app; an older one turns replies away.
