# Today

- **Today** — fuel for each athlete first, then each athlete's energy, then each
  zone's progress from its first estimate to its goal (Strength's from the lift
  targets), then a race-day estimate: the pair's Strength score, each athlete's share
  of it, and where it would have placed among last season's mixed Lite pairs; the
  2.4 km run times and SkiErg distance for Endurance; and the MetCon X time. The
  ATHX Lite running order follows: every workout of race day in the order it is
  run, the three Strength lifts, the 2.4 km run and the SkiErg, then the seven
  MetCon X stations, with the refuel and recovery breaks between zones. Beside
  what each one asks of each of you, such as your load at a station, a pill
  says when each of you last did it: green within 5 days, yellow within 14,
  red past that or never. Under the pill on the three lifts, the run and the
  two rows, two dots in your colour fill for each day of the last 7 you did it,
  so twice a week shows as both filled, with the count beside them. See [The
  running order](race.md#the-running-order). Then the days each of you trained this week and over the last 7 days against the
  weekly target of training days (two sessions on one day count once), and
  under them the last 7 days as a strip, a dot for each session in
  its athlete's colour, with what each one was listed beneath: the time, who and
  what, the burn, lifts, distance and notes. Tap a day for that day alone, step
  back a week at a time, or switch to **Month** for a calendar to tap. Days older
  than the phone's recent slice are fetched for the strip or month being shown
  (`/api/records?from=…&to=…&kind=workout`), not shown as empty. Fuel switches between today, yesterday, the last 7 days, and
  the whole journal. **Pick day**, beside Overall, shows any past date, including
  entries older than the phone's recent slice. **Custom window** turns the
  day into a start and an end, both included, and offers presets to fill them
  in: **MTD**, **1M**, **1Q**, **6M**, **YTD** and **1Y**. Each ends yesterday,
  like the last 7 days; the rolling ones start the same date that many months
  back, or that month's last day when it is shorter. MTD and YTD are greyed out
  on the 1st and on 1 January, which have no complete day yet. A preset shows
  as selected while the dates still match it. A single day is that day's macros against
  the daily targets. A longer range is the daily average of days that have a meal,
  so a day you forgot to log is not treated as a day you ate nothing, with the
  totals written under the bars. The last 7 days and the whole journal count
  complete days only: the seven days before today, and every day up to
  yesterday. Today joins them tomorrow; counted in, this morning's breakfast
  stood for a whole day of eating and pulled the average down until dinner. A
  bar past its target no longer stops at the end: the bar stands for all that
  was eaten, a tick marks where the target falls inside it, and the part past
  the target is striped. The calorie bar is split into protein, carbs and fat,
  each a tint of the athlete's colour, by its estimated share of the calories
  logged (`macroCalories`), with grey for calories the macros do not account
  for, such as alcohol. Each macro's row gives that share beside its name with
  the matching swatch, as "~28% of kcal", apart from its "% of target" on the
  right. Under each athlete's food is their
  expenditure, resting energy and training together, and the balance of eating
  against it: for a day, that day's; for a longer range, a day's average. See
  [Resting energy and the balance](figures.md#resting-energy-and-the-balance). The race-day estimate, Progress and
  Fuel over the whole journal are worked out on the server from every entry,
  so an old best counts however much has been logged since. Under the counts,
  the last 7 days list each session, including its time, what it burned, and
  the whole-session estimate when the stations support one. Under that is a
  request log for features and ideas:
  shared between the two of you, kept with the journal, and not listed in the
  Log. Mark one done when it has been dealt with, or delete it.
  Tap any box away from its buttons to fold it to one line, such as this
  week's counts, and see what is under it; tap again to open it. The days to
  go are a chip at the left of the header, "295 d", and read out in full to a
  screen reader.
  **Energy** is how each of you feels, out of 10, from 1 (exhausted) to 10
  (full of energy), at breakfast, lunch and dinner. A tap on an athlete's
  row logs a check-in, and its level then keeps the athlete's ring: a tap on
  another level changes it and keeps its time, and **Log another** beside it
  adds a second on purpose. A second tap used to add one every time, so a
  slip could only be averaged in, not corrected, without going to the Log. A
  timing takes as many as are logged; its row shows and changes the latest,
  and the Log moves or deletes any of them. The timing
  starts where a meal's sitting would at that hour (5–10 breakfast, 11–14
  lunch, 17–21 dinner); energy has no snack, so the afternoon counts as lunch,
  the late evening as dinner and before 5 as breakfast. Tap another timing,
  or press B, L or D as on a meal, to log or change a different one
  (`lib/meal-time.ts`). Once either of you has logged a timing on the chosen
  day, its button carries a dot for each of you, Hippos first, filled for
  whoever has logged it and hollow for whoever has not, so a missed one shows
  without opening it. Each row says what that timing holds: one check-in's
  level and time, or several levels and their mean. The date buttons above
  the rows, Today, Yesterday or a day off the calendar, log a missed day the
  same way. Only today at the clock's timing takes the clock's time; any
  other has none, since the clock now is not when that was felt. Check-ins
  from before there were timings count as the timing their time falls in,
  and ones with no time as a timing of their own. Once both of you have
  checked in at the clock's timing, the box opens folded to that one line,
  and it opens again at the next timing. Under the rows, the last 7 days for
  both of you and each one's average over the days that have a check-in. A
  day's level is the mean of its timings' means, so each timing weighs the
  same however often it was logged: seven at lunch and one each at breakfast
  and dinner is a third lunch (`lib/energy-level.ts`). A day nobody logged is
  left out, not counted as no energy. It is subjective and nothing else is
  worked out from it. Check-ins are journal entries, so they wait on the
  phone without a connection like anything else, and, being small, are always
  sent whole, like weigh-ins, however much of the journal the phone holds.
