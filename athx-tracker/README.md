# Hippos & Gators · ATHX 2027

A shared training and nutrition journal for two athletes working towards ATHX Lite
in New York. Self-hosted: a Next.js app in a container, with the whole journal in a
single SQLite file on a volume.

## What it does

- **Today** — countdown to the event, then fuel for each athlete, then each
  zone's progress from its first estimate to its goal (Strength's from the lift
  targets), then a race-day estimate: the pair's Strength score in kilograms, each athlete's share
  of it, and where it would have placed among last season's mixed Lite pairs; the
  2.4 km run times and SkiErg distance for Endurance; and the MetCon X time. Then
  the sessions logged this week and over the last 7 days against the weekly
  target, and under them the last 7 days as a strip, a dot for each session in
  its athlete's colour, with what each one was listed beneath: the time, who and
  what, the burn, lifts, distance and notes. Tap a day for that day alone, step
  back a week at a time, or switch to **Month** for a calendar to tap. Days older
  than the phone's recent slice are fetched for the strip or month being shown
  (`/api/records?from=…&to=…&kind=workout`), not shown as empty. Fuel switches between today, yesterday, the last 7 days, and
  the whole journal. **Pick day**, beside Overall, shows any past date, including
  entries older than the phone's recent slice. A single day is that day's macros against
  the daily targets. A longer range is the daily average of days that have a meal,
  so a day you forgot to log is not treated as a day you ate nothing, with the
  totals written under the bars. Under each athlete's food is their
  expenditure, resting energy and training together, and the balance of eating
  against it: for a day, that day's; for a longer range, a day's average. See
  *Resting energy and the balance* below. The race-day estimate, Progress and
  Fuel over the whole journal are worked out on the server from every entry,
  so an old best counts however much has been logged since. The last session stays underneath,
  with its time, what it burned, and the whole-session estimate when the
  stations support one, and so does the ATHX Lite running order.
  Tap any box away from its buttons to fold it to one line, such as the days to
  go or this week's counts, and see what is under it; tap again to open it.
- **Session** — log a workout as MetCon, Strength, Endurance, Solidcore, Tennis, YTW or
  Other, with Solidcore, tennis and YTW a tap away under Quick start. Load the seven
  ATHX stations with one tap, then fill in what you completed and each split.
  Elapsed time, station times, lifts and notes are all optional: a session with
  nothing timed is still a session, and reads as a dash rather than as a time of
  zero. Pairs or solo follows the switch at the top unless you set it yourself,
  and Other takes a name of its own, which is what the log then calls it.
  Other also takes the calories each athlete burned, from a watch or a machine;
  typed, that figure is the session's burn, and left empty it is estimated.
  A lift is one weight for every set, or, under **Advanced**, a row for each set
  with its own weight and reps. Sets that differ are listed one by one in the
  log, every rep counts towards the burn, and Progress takes the heaviest.
  **Mixed** puts lifts, MetCon and endurance in one session: add the ATHX
  circuit, your own MetCon stations, or a run/erg, alongside lifts. MetCon
  stations take a load per athlete. On a new session the circuit's stations
  start at the standard weight, rounded to the rack (nearest 5 lb, or 2.5 kg),
  so saving untouched records it; a station you never reached does not record
  the weight left in its box. Editing an entry shows exactly what was saved,
  blank included. A MetCon you did not finish is logged as what you completed at
  each station, and "stopped at the time cap" records the cap; the log then
  reads e.g. "5/7 movements · 82% of the work · time cap hit". The lb/kg switch
  on the form is the same setting as Setup's and is remembered.
  **Describe your workout** accepts typed text or browser dictation and uses the
  same subscription-backed estimator as meals to fill an editable draft. `1 x 2`
  means **1 set of 2 reps**. Include weights and units; an omitted unit follows
  the form's lb/kg setting. Sets that differ, such as `135x5, 185x3, 225x1` (a
  weight, then its reps), open Advanced with a row for each. Named results stay
  with that athlete, and missing numbers stay blank for review; a lift saves
  only once its blanks, a set's reps included, are filled in. Lifts, workouts
  and MetCons are matched to the names already in the list, including typos and
  loose phrasing. A name that is not one of those is kept as typed and called
  out in the notes. AI replaces the workout fields but saves only when you
  choose Save session. Unsupported browsers can use keyboard dictation.
  A session takes a time of day, which starts at the clock and can be cleared.
  Saving a lift heavier than any of that athlete's earlier sessions, or the
  same weight for more reps, says so: "New best: Back squat 195 lb × 5, up from
  185 lb × 5". Less weight for more reps is not a best, since nothing is
  carried up to a max. The server checks every earlier session, the session's own
  earlier version included, so saving an edit announces nothing it already held.
  What is typed and not saved yet is kept as a draft; see *Drafts*.
- **Meal** — describe a meal and let Grok estimate the macros, or type them in
  yourself. Editing an estimated number saves the meal as your own figures.
  Calories keep the source's reported or estimated total, including in queued
  meals. A rough 4/4/9 comparison (plus ethanol at 7 kcal/g on Alcohol) is
  advisory: differences never block saving or rewrite calories. Total carbs
  include fiber; fiber, sugar alcohols, food-specific factors and rounding can
  make the simple calculation differ from a label's calorie total. A meal takes
  a time of day, which starts at the clock; a new meal's sitting follows it until
  you pick one. A meal logged on more than one day is offered again. Save it as
  a template to keep your own name, items and grams; tapping one fills the form,
  and the saved macros stay until you estimate again. A meal typed and not
  saved yet is kept as a draft; see *Drafts*.
  Logging for both saves the same meal for each of you, unless you choose
  **Split by dish**: what is on the form becomes the first dish, and you add
  the rest. Each dish has its own figures, typed or estimated from what the
  dish says, and a share for each of you as a percentage of that dish, starting
  at half each. The two shares always add up to 100: typing one sets the other,
  and blank counts as 0. Saving writes one meal for each of you with a share,
  holding your share of every dish (`splitMeal` in `lib/meal-dishes.ts`), so
  the two meals add up to what was on the table. Someone with no share of
  anything gets no meal, and switching to one of you saves only that share. A
  name left blank becomes each person's own dishes. The assumptions give your
  share of each dish and the whole dish's figures, then how that dish's figures
  were reached. A meal reads as estimated when every dish in it was estimated
  and left alone. Each dish's estimate counts towards the daily limit, one runs
  at a time, and a dish cannot wait in the queue for later. Templates and
  replies to an estimate are for a single meal, so a split meal does not offer
  them. The two saved meals are separate entries, edited one at a time.
- **Progress** — the main lifts for each athlete: split jerk, overhead press
  (push press for Hippos), back squat and deadlift, each at the rep max the
  race's Strength asks for: a 1RM for the jerk and the press, which are both
  shoulder to overhead, a 2RM back squat and a 3RM deadlift. Each shows its
  start, latest, best and target, how far is left, and a bar towards the
  target: grey up to the start, the athlete's colour for what has been gained
  since. A day's figure is the most any of its sets shows for that rep max,
  read the way the race estimate reads it (see *The race-day estimate*):
  never carried up, so five at 155 lb is a 155 lb 2RM squat, and carried down
  from fewer reps, so a 100 kg single is a 97.2 kg 2RM. A warm-up is never the
  figure, and at the same figure the set of more reps stands. Under each figure
  is the set it comes from. Start is the first day the lift was logged, and a
  best belongs to the first day it was reached. Names are
  matched the way a described workout's are, so "OHP" typed under Other counts,
  while push press, front squat and Romanian deadlift stay lifts of their own.
  Together sessions count for neither athlete. The total is the athlete's
  share of the Strength score: shoulder to overhead, back squat and deadlift
  added, where shoulder to overhead counts any press or jerk the race does,
  so its best is the race estimate's figure. Its target takes the higher of
  the press and split jerk targets for shoulder to overhead.
  Under each lift, the volume of the last eight Monday weeks, load times reps
  across every set, this week's growing as it is logged. Each athlete's card opens
  with their bodyweight from the weigh-ins and how far it has moved. All of it is
  worked out over the whole journal, not the slice the phone holds.
  **ATHX benchmarks** compares actual circuit times and individual station splits,
  with best, latest, previous and attempt history. Only matching work, loads and
  solo/pairs context are compared; unknown loads stay separate from recorded
  loads. A circuit needs all seven stations in race order, a dedicated MetCon
  clock and no lifts. Mixed-session clocks are excluded, but their station
  splits can count. Completed, capped and unfinished circuits stay separate;
  capped/unfinished attempts compare the average station completion share only
  when their elapsed times match. Nothing is projected to a finish.
  **Weekly review** compares each athlete's sessions, training mix, timed work,
  endurance distance, lift volume, benchmark improvements and daily macro
  averages with the previous week. The current week compares the same weekdays
  through today; earlier weeks run Monday to Sunday. Lift volume counts every
  set's load times reps. Nutrition averages use days with known meal macros;
  unlogged days and pending estimates are excluded, while partial days count.
  There is no daily completion step. Benchmarks and the weekly review read the
  entries the phone holds; while only the recent slice is loaded they say so
  and offer the rest.
- **Log** — everything logged, newest first and, inside a day, latest time of day
  first, filterable, with edit and delete, each session showing what it burned.
  Weigh-ins are entries too, corrected where they stand. It opens with the most
  recent entries and fetches the rest when asked, and draws a hundred at a time
  however many are loaded, so a journal years deep neither crosses the network
  nor reaches the screen all at once. What this phone has not sent yet is marked
  as waiting; see *Without a connection*.
- **Setup** — event name and date, weekly session target, display units, each
  athlete's bodyweight, height and birth year, their daily macro targets, their
  lift targets, and food notes. The bodyweight is what makes calories burned
  possible; without it that figure is withheld. A new bodyweight saved here is a
  weigh-in dated today, not a change to every day: see *Calories burned*. Height
  and birth year add resting energy, and the box under them shows it as you type.
  Height is in inches beside pounds and centimetres beside kilograms, and stored
  in centimetres. Changing a daily target keeps the old one as the target for
  every day up to yesterday, so a past day is judged against what it had.
  Lift targets are stored in kilograms like every other weight, and each is
  the rep max Progress measures that lift at, which Setup names beside it.
  Gators' default to a 175 lb split jerk and 135 lb overhead press for one,
  a 255 lb back squat for two and a 335 lb deadlift for three; Hippos has none
  until set, and a blank target is no target.
  Each athlete's targets are for the lifts Progress follows for them, so Hippos
  sets a push press where Gators sets an overhead press.

### Weights and older entries

Every weight is stored in kilograms and converted for display, so switching
lb/kg never rewrites a record. Opening an entry and saving it again keeps the
stored load exactly, rather than re-reading it from its rounded display.
Stations saved before sessions could mix carry no part or load: their part is
taken from the session's category (Endurance is endurance, anything else is
MetCon), and a missing time-cap flag reads as no. Entries from before times of
day have none and sort after the timed ones on their day; settings from before
dated targets, heights and birth years read as one set of targets for every day
and nothing given. No migration is needed.

### Calories burned

`estimateBurn` in `lib/domain.ts` uses the compendium formula, MET x 3.5 x kg / 200 per
minute, with METs for vigorous effort. It needs a bodyweight and a duration, which a
session logged without a time does not have. Either missing and the figure is withheld
rather than guessed, because a number that looks measured and is not is worse than no
number.

The bodyweight is the one in force on the session's day (`bodyweightOn` in
`lib/bodyweight.ts`): the latest weigh-in on or before it. A day before the first
weigh-in takes the weight Setup held before weigh-ins were dated, which is what every
burn used until then, so none of those burns moves; with no such weight, the first
weigh-in, the nearest one known. Weigh-ins are journal entries, so the phone always
holds all of them, however small the slice of everything else.

An Other session can be anything, so its one MET is a guess, and calories typed on it
are its burn instead: as typed, not rounded, and without needing a bodyweight. Fuel
still counts no training burn, typed or estimated, until a bodyweight is known.

A Mixed session has no single MET, so `sessionMet` weights it by where the time
went: timed MetCon stations at 8, timed endurance at 9, and the untimed rest at
strength's 6 when there are lifts (otherwise at the MetCon's, or endurance's).
Every other category keeps its one figure, so no earlier burn changes.

### The full-workout scenario

`projectWorkout` in `lib/domain.ts` extends a part-finished workout to the whole thing:
observed time kept as measured, only unperformed work extended at the pace you actually
held at that station, plus a fatigue allowance. A station you never started is never
given another movement's pace, and one finished but never timed has no pace to offer, so
it declines rather than guessing.

It is worked out again from the stations, fatigue and transition already on the
session, not stored as a second figure that could drift. Reading a part-finished
session shows it as one line, on the log entry and on Today's last session: the
estimated finish as a clock time, beside the time and the burn. A session with no
stations, no elapsed time, unfinished work that has no pace, or station times that
cannot fit the elapsed time shows nothing, not a zero. Logging still does not ask
for it.

### The race-day estimate

`raceEstimate` in `lib/race.ts` works out what the pair would score in each zone if
the race were today, from what is logged. The format is ATHX Lite pairs in the 2027
season, which is the same at every event: see the 2027
[workouts](https://athxgames.com/workouts/2027) and
[movement standards](https://athxgames.com/movement-standards/2027). Each figure is
the best the log has shown, carried to the race's reps, distance or time. Whatever
the log cannot support shows a dash and says what to log, rather than a guess.

- **Strength** is a 1RM shoulder to overhead, a 2RM back squat and a 3RM deadlift
  for each of you, all six added. Each is the most any logged set shows, and a
  set is never carried up: one of at least the reps asked for shows only that
  its load goes up that many times, so five at 155 lb is a 155 lb 2RM squat,
  not the 170 lb a formula would make of it. A set of fewer reps is carried
  down on Brzycki's line, where the most you can lift *r* times is
  (37 − *r*)/36 of a 1RM, so a 100 kg single is a 97.2 kg 2RM. Either way the
  figure can only err low.
  Shoulder to overhead counts the overhead press, push press, split jerk, a typed
  push jerk, and the clean and jerk. Figures are whole kilograms and the totals add
  what is shown; nothing is combined until all six lifts have one. The race averages
  each athlete's two deadlift attempts, so the figure assumes both reach it.
- **Endurance** has each of you run 2.4 km, then the pair skis on its one SkiErg
  until 24:00: the first back starts alone, and once you are both there you take
  turns, half the time each. Run times and SkiErg distances follow Riegel's curve,
  where time grows with distance to the power 1.06, from the quickest run and the
  farthest-reaching SkiErg piece of at least a kilometre. A shorter piece is a
  sprint, not a race. Each athlete's metres come from their whole time on the erg,
  which errs low for someone resting between turns. The score is the metres skied.
  The run and the SkiErg show apart, so either can be read before the other is
  logged: each of you has a 2.4 km time once you have a run, and until both runs
  are in, the SkiErg shows each of your farthest-reaching pieces and their pace.
  On Riegel's curve that piece is the farthest at any time on the erg, so it is
  the one the metres will come from.
- **MetCon X** gives each station to whichever of you has timed it quicker, at the
  quickest pace you have shown there; with one pace logged, that athlete takes it.
  It is a plan you can always carry out, and taking turns well can only beat it. An
  even split at the paces you hold going solo came out slower than the quicker
  athlete alone, which is why it is not used. The carry is 30 m each, so it needs
  both of you. The opening and closing rows are one machine and lend each other a
  pace; nothing else borrows one. An attempt logged lighter than race weight is not
  race pace and is left out, though the rack's nearest load counts (Hippos' 7.5 kg
  is offered as 15 lb, 6.8 kg), and one with no load recorded is taken as it
  stands. Time between stations is what circuits logged on
  their own with an elapsed time show beyond their splits, spread over the six
  changes; without one, the estimate is the stations alone and says so.

Together sessions count for neither athlete. The phone holds only the recent
slice of the journal, so the server works the estimate out over all of it
(`journalSummary` in `lib/summary.ts`, the same functions the phone runs) and
sends the figures; with the whole journal loaded the phone works them out itself.

**Progress** on Today measures each zone from its start to its goal. The start is
the zone's estimate as of the first day the log could give one, counting only what
was logged up to then (`raceStart` in `lib/race.ts`); now is today's estimate; the
goal for Strength is the lift targets Progress measures against, each already the
race's rep max for its lift, in whole kilograms (the higher of the athlete's
press and split jerk targets stands for shoulder to overhead; a target for the press
an athlete does not follow is not counted), so it needs all six; Endurance
and MetCon X take Setup's race goals (SkiErg metres, and a time that counts down). The bar is the share of start-to-goal covered,
clamped to 0-100%. A zone with no goal shows start and now only.

**The Strength percentile** places the pair among every mixed ATHX Lite pair from
the 2026 season, 264 pairs at 15 events on the
[ATHX team leaderboard](https://athxgames.com/team-leaderboards), as the share of
them it would have beaten. 2026 scored a strict press for one, a squat for three
and a deadlift for five, so the pair is placed on those lifts, carried from the
logged sets the same way, and not on 2027's, which would flatter it. Until each of
you has a strict press logged, a jerk alone places nobody, and the estimate says
so. Endurance and MetCon X changed format for 2027, so they are not placed until
2027 results exist. The field lives in `lib/field-data.ts`, and
`node scripts/pull-field.mjs 2026` rebuilds it from the leaderboard.

### Resting energy and the balance

Resting energy is Mifflin and St Jeor's equation
([Am J Clin Nutr 1990;51:241-7](https://doi.org/10.1093/ajcn/51.2.241)):
10 x kg + 6.25 x cm - 5 x age, plus 5 for a man or minus 161 for a woman, with
Gators a man and Hippos a woman. The weight is the one in force that day, and the
age is that day's year less the birth year. Expenditure is resting energy and
training together. It is still short of a day's whole spend, because everyday
movement and digesting food are in neither figure, and Fuel says so. Without a
height and a birth year it is withheld, and Fuel shows training on its own, named
as such, rather than a figure that would read as a whole day's spend.

For a day, the balance is that day's food less its expenditure. For a longer
range, food is averaged over the days with a meal, as the bars are, and
expenditure over every day of the range, since a day is spent whether or not it
was logged; the whole journal starts at the athlete's first entry. The balance is
the one less the other, a day's worth. Estimates show to the nearest ten.

### Without a connection

A save that gets no answer within 15 seconds, or that meets a server or proxy
failure, or a lapsed sign-in, waits on the phone instead of failing: the session
or meal is shown as saved, marked as waiting in the Log and counted beside the
refresh button, and sent by itself when the app comes back into view, when the
phone comes back online, every minute while anything waits, and the next time the
app opens. Records carry ids made on the phone and the server upserts on them, so
sending one twice is harmless. A delete waits the same way. One the server turns
down for good is set aside, marked with the reason, for an edit or a delete. What
waits is kept in browser storage; a phone that refuses storage keeps it until the
app closes. The whole-journal figures catch up once it is sent.

The app also opens with no connection, once it has been opened with one: a
service worker (`public/sw.js`) keeps the last copy of the journal page and the
built files it needs, and serves them only when the network does not answer. Each
deploy brings a new worker and drops the old copy. Signing out deletes the copy;
anything still waiting stays, and sends after the next sign-in.

Coming back to the app fetches what the other phone logged, at most every 30
seconds. While Setup holds unsaved typing, the settings are left alone and only the
entries are fetched.

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

After estimating, review the assumptions above the meal fields. **Reply to
estimate** opens a conversation where you can correct portions or ingredients,
or ask how the figures were reached. Each reply includes your earlier
clarifications and updates the meal's macros and assumptions. Failed replies
keep the current estimate and the text you were typing.

Meal and Session drafts stay open when you switch sections, including while AI
is processing. If an estimate finishes while you are elsewhere, a small popup
offers to take you back to review it. Failed estimates also notify you and keep
the description for retry. Nothing reaches the journal until you choose to save
the form.

While a meal estimate runs, each estimator's figures appear under **Answers so
far** as it answers. They are shown, not applied: the meal waits for the
settled answer, which may average them or keep only the best-sourced one.
**Stop estimate** ends it, stops the estimator's CLIs, gives the daily
estimate back, and unlocks the form to edit. A stopped estimate raises no
popup.

**Save and estimate in background** saves the meal now, with zero macros and
the description kept, and the server estimates it with the same estimators and
the same settling, with nobody waiting on it. Pressed mid-estimate, it takes
over from the one on screen. The server starts within a few seconds of the
save rather than at its two-minute retry timer, and a meal logged for both
athletes is estimated once and both records are filled with the same figures.
While one is waiting, the app looks for its figures every 15 seconds, and a
popup says when they arrive, from whichever section is open. It is offered
until there is an estimate on the form, since a queued meal would throw those
figures away. Background estimates do not count toward the 60 a day. They
need the estimator: with only `XAI_API_KEY` set, the button is not offered,
since the worker asks the gateway and nothing else.

### Drafts

What is typed into the Meal or Session form is kept on the phone as it is
typed (`lib/drafts.ts`, `hooks/use-form-draft.ts`), so the app being closed, the
phone dropping it from memory, or a reload loses none of it: opening the form
again opens it as it was left, an unsaved edit of an entry included, which says
"unsaved changes restored". A form that is opened and not typed in keeps no
draft, and neither does one typed in and emptied again.

**New meal** or **New session** above a form with a draft sets it aside and
starts a fresh one; **Discard draft** throws it away. Drafts set aside are
listed at the top of their tab, newest first, with who they are for and when
they were last typed into. Tapping one opens it on the form, and the one that
was open joins the list. Saving the form deletes its draft, Cancel on an edit
deletes that edit's draft, and deleting an entry in the Log deletes any unsaved
edit of it. Drafts belong to the phone they were typed on and are not sent to
the server. A draft the form cannot open, as one saved by an older version of
the form could be, is removed with a notice rather than breaking the app.

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
