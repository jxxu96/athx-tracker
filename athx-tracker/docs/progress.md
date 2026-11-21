# Progress

- **Progress** — the main lifts for each athlete: split jerk, overhead press
  (push press for Hippos), back squat and deadlift, each at the rep max the
  race's Strength asks for: a 1RM for the jerk and the press, which are both
  shoulder to overhead, a 2RM back squat and a 3RM deadlift. Each shows its
  start, latest, best and target, how far is left, and a bar towards the
  target: grey up to the start, the athlete's colour for what has been gained
  since. A day's figure is the most any of its sets shows for that rep max,
  read the way the race estimate reads it (see [The race-day estimate](race.md#the-race-day-estimate)):
  never carried up, so five at 155 lb is a 155 lb 2RM squat, and carried down
  from fewer reps, so a 100 kg single is a 97.2 kg 2RM. A set counts the reps
  it made: a failed final rep was not made, so a failed single shows nothing
  and three with the third failed is a double. A warm-up is never the
  figure, and at the same figure the set of more reps stands. Under each figure
  is the set it comes from. A best carried down from fewer reps was worked
  out, not lifted: on the bar it is a ring with a dot in the middle in place
  of the hatched ring, and its column reads Est. best (`carriedDown` in
  `lib/progress.ts`). The total's best is marked the same way when any of its
  three is. Start is the first day the lift was logged, and a
  best belongs to the first day it was reached. Names are
  matched the way a described workout's are, so "OHP" typed under Other counts,
  while push press, front squat and Romanian deadlift stay lifts of their own.
  Together sessions count for neither athlete. The total is the athlete's
  share of the Strength score: shoulder to overhead, back squat and deadlift
  added, where shoulder to overhead counts any press or jerk the race does,
  so its best is the race estimate's figure. Its target takes the higher of
  the press and split jerk targets for shoulder to overhead.
  Under each lift, a chart of its figure over time, the best of each Monday
  week on the day it was first reached, with the target as a level line when
  there is one (`weeklyBests` in `lib/progress.ts`; a point a week keeps the
  summary small however long the season), and the volume of the last eight
  Monday weeks, load times reps across every set, this week's growing as it is
  logged. Each athlete's card opens with their bodyweight from the weigh-ins,
  how far it has moved, and a chart of every weigh-in as a faint dot with the
  seven-day average as the line: the mean of the weigh-ins in the seven days up
  to each one (`weeklyAverage` in `lib/bodyweight.ts`), since a day's weight
  moves with water and food by more than a week of training does. Under it,
  protein as a share of the target for each of the last eight Monday weeks,
  counted the way the bagel counts last week: days with a known meal, each
  against the target it had, and today only once it is over
  (`proteinWeeks` in `lib/protein-week.ts`); the week under way is drawn
  lighter. Each chart is one athlete's, so colour never has to tell the two of
  you apart, and every value is also in a table under it. The charts' code is
  fetched the first time Progress draws one (`components/progress/lazy-charts.tsx`), so
  the app opens no heavier; offline before that, a chart's place stays empty
  and the figures above it still show. All of it is worked out over the whole
  journal, not the slice the phone holds.
  **ATHX benchmarks** compares actual circuit times and individual station splits,
  with best, latest, previous and attempt history. Only matching work, loads and
  solo/pairs context are compared; unknown loads stay separate from recorded
  loads. A circuit needs all seven stations in race order, a dedicated MetCon
  clock and no lifts. Mixed-session clocks are excluded, but their station
  splits can count. Completed, capped and unfinished circuits stay separate;
  capped/unfinished attempts compare the average station completion share only
  when their elapsed times match. Nothing is projected to a finish.
  **Weekly review** compares each athlete's days trained, training mix, timed work,
  endurance distance, lift volume, energy, benchmark improvements and daily macro
  averages with the previous week. Energy is the average of the days with a
  check-in, each day the mean of its timings' means. The current week compares the same weekdays
  through today; earlier weeks run Monday to Sunday. Lift volume counts every
  set's load times reps. Nutrition averages use days with known meal macros;
  unlogged days and pending estimates are excluded, while partial days count.
  There is no daily completion step. Benchmarks and the weekly review read the
  entries the phone holds; while only the recent slice is loaded they say so
  and offer the rest.
