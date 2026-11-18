# Race day

## The race-day estimate

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
  push jerk, and the clean and jerk. Figures are whole units of the screen's weight, each lift converted from its
  exact figure so a 155 lb set reads 155 lb, and the totals add
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
was logged up to then (`raceStart` in `lib/race.ts`), kept in whole kilograms, so in
pounds Strength's start is that one figure converted; now is today's estimate; the
goal for Strength is the lift targets Progress measures against, each already the
race's rep max for its lift, in whole units of the screen's weight (the higher of the athlete's
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

## The running order

`RUNNING_ORDER` in `lib/running-order.ts` is race day for a Lite pair in the order
ATHX runs it (the [timeline](https://athxgames.com/new-to-athx-games)): Strength,
which is a 1RM shoulder to overhead in minutes 0-5, a 2RM back squat in 5-10 and a
3RM deadlift in 10-20; a 10-minute refuel; Endurance, 2.4 km each and then the
SkiErg to the 24:00 cap; a 30-minute recovery; then MetCon X's seven stations to the
25:00 cap, each athlete's load beside the stations that have one (the 2027
[workouts](https://athxgames.com/workouts/2027)).

The last time (`lastDone`) is the newest day, on or before today, that the
athlete's own session did the workout: a lift with reps, at any load, or a station
with work or time logged against it. A circuit station left at zero was not
reached, or in pairs was the other one's, so it does not count. The Strength rows
count what the estimate counts, so any press or jerk from the shoulders is shoulder
to overhead; everything else is its own name, the way the list spells it, so a
front squat is not a back squat and a plain burpee is not a burpee over the bench.
The opening and closing rows are one machine, and a row anywhere counts for both.
A Together session counts for both of you, since you both did the work; the
estimate still leaves it out, since it cannot say whose number it is. The pill
is green at 5 days or less, yellow at 14 or less, and red past that or never; the
day itself shows beside it on a wider screen, and is read out. Folded, the box
counts each athlete's red rows.

The three lifts, the run and the rows (`TWICE_WEEKLY`) also count the last 7 days,
today and the six before it as the Sessions box counts them, against twice a week
(`weekDays`). It counts days, not sessions, so two sessions at it on one day count
once; what counts as doing it, and whose it is, Together included, is the same as
for the last time.
Two dots under the pill fill in the athlete's colour, one for each day, and the
count beside them carries a third day and more. The SkiErg and MetCon X's other
stations are not counted.

The phone holds only the recent slice, so the server works the last times and the
week's days out over the whole journal (`journalSummary`). The phone still answers
for the days it holds whole, so a session saved or deleted on it shows at once
(`seenTable`, `weekTable`). Without the server's answer, a week that reaches past
the slice shows the phone's count with a "+", as at least that many.
