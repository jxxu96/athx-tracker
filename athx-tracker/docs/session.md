# Session

- **Session** — log a workout as MetCon, Strength, Endurance, Solidcore, Tennis or
  Other, with Solidcore and tennis a tap away under Quick start. YTWs is a lift.
  Load the seven
  ATHX stations with one tap, then fill in what you completed and each split.
  Elapsed time, station times, lifts and notes are all optional: a session with
  nothing timed is still a session, and reads as a dash rather than as a time of
  zero. Pairs or solo follows the switch at the top unless you set it yourself,
  and Other takes a name of its own, which is what the log then calls it.
  Every session takes the calories each athlete burned, typed from a watch or a
  machine or filled by AI (below); a figure there is the session's burn, and
  left empty it is estimated.
  Choosing a lift fills its sets and reps with real numbers: three sets, at
  one rep for the split jerk, three for the deadlift, and five for the back
  squat, the bench press and anything else (`DEFAULT_SETS` and `defaultReps`
  in `lib/exercises.ts`). Choosing another lift moves them to its defaults
  until you type in them. The boxes used to show a grey 3 and 5 that were
  only placeholders, and leaving them saved one set of one. A box left blank
  now reads as 0: no weight is an unweighted lift, such as pull-ups, and no
  sets or reps are none recorded, never one. The log leaves out what was
  blank: "Pull-up 3×8", "Dumbbell row 60 lb 3 sets", and opening the session
  again shows those boxes blank. A set with no reps is never a best, and a
  failed final rep is not counted, so a failed single is never one. A lift
  counts once anything is typed into it; logging one athlete, a lift chosen
  and left at its defaults with no weight saves as it shows, but logging
  both, defaults alone do not, since the other one may not have done it
  (`liftLogged` in `components/workout/workout-form.tsx`). Under the
  lift's name, each athlete's column shows their last time at it, such as
  "Last 225 lb 3×3 · Wed 4 Nov", from the newest session on or before the
  session's day (`lastLift` in `lib/last-lift.ts`, names matched the way a
  described workout's are), and **Use** copies those sets into the row, a
  breakdown of differing sets included. The entry being edited is not its own
  last time, and only sessions the phone holds are searched.
  A lift is one weight for every set, or, under **Advanced**, a row for each set
  with its own weight and reps. Advanced opens a row per set from sets and reps
  you typed, but over the form's defaults it opens one set at your weight with
  the reps empty, and **+ Set** adds the rest; closing it untouched gives the
  defaults back. An empty box in a set reads as 0 too, and a set left wholly
  blank is left out.
  Sets that differ are listed one by one in the
  log, every rep counts towards the burn, and Progress takes the heaviest.
  **Mixed** puts lifts, MetCon and endurance in one session: **Complete ATHX
  circuit** adds all seven stations, **+ Station** one at a time, and
  **+ Endurance** a run or erg, alongside lifts. A station is picked from the
  ATHX stations alone, not the lifts, with Other… for anything unlisted, and
  starts at its own unit: calories for a row, metres for the carry, reps for
  the rest (`stationUnit` in `lib/exercises.ts`). Only the circuit's stations
  have a target. A station you add has none: what you did there is the whole
  of it, and an athlete who left it blank has nothing saved for it, which in
  pairs is how one of you takes a station the other did not. A time or load
  typed there still needs the work done with it. MetCon
  stations take a load per athlete. On a new session the circuit's stations
  start at the standard weight, rounded to the rack (nearest 5 lb, or 2.5 kg),
  so saving untouched records it; a station you never reached does not record
  the weight left in its box. Editing an entry shows exactly what was saved,
  blank included. A MetCon you did not finish is logged as what you completed at
  each station, and "stopped at the time cap" records the cap; the log then
  reads e.g. "5/7 movements · 82% of the work · time cap hit". The form's
  weight boxes follow the lb/kg switch at the top of the screen. Time boxes,
  elapsed, station and goal times and Setup's MetCon X goal, open the number
  pad and put the colon in themselves: the last two digits are the seconds,
  so 2530 reads 25:30 (`typedClock` in `lib/domain.ts`).
  **Describe your workout** accepts typed text or browser dictation and uses the
  same subscription-backed estimator as meals to fill an editable draft.
  Numbers joined by x read by position: two are **reps x weight**, one set
  (`5x165` is 5 reps at 165), and three are **sets x reps x weight**
  (`3x5x135` is 3 sets of 5 at 135). This holds whatever the lift and the size
  of the numbers, so `pull-ups 3x8` is 3 reps at 8; write `3x8 bodyweight` or
  `3 sets of 8` for sets of an unweighted lift. A weight given apart from the
  x, as in `1 x 2 at 185 lb`, makes the two numbers sets x reps, and a weight
  unit marks its number as the weight wherever it sits (`60 kg x 8` is 8 reps
  at 60 kg). An omitted unit follows the lb/kg switch. Sets that differ, such as
  `5x135, 3x185, 1x225`, open Advanced with a row for each. Named results stay
  with that athlete, and missing numbers stay blank for review, saving as 0
  if left: a weight never said is unweighted. Lifts, workouts
  and MetCons are matched to the names already in the list, including typos and
  loose phrasing. A name that is not one of those is kept as typed and called
  out in the notes. AI also fills **Calories burned** for each athlete: a
  burn the description states, from a watch or a machine, as stated (a 40 cal
  row is that station's work, not the session's burn); otherwise worked out
  from the activities, their effort and minutes, and that athlete's weight on
  the session's day (`draftBodyweights` in `lib/workout-draft.ts`), with
  Compendium METs, rounded to ten and taking the lower of two plausible
  figures. With no weight known it works none out. A time it had to estimate
  for the burn stays out of the time boxes, and its working goes in the notes.
  An estimator from before burns leaves the box empty, and the burn is the MET
  estimate. AI replaces the workout fields but saves only when you
  choose Save session. Unsupported browsers can use keyboard dictation.
  An AI burn is for the workout AI filled. Change that workout before saving
  (its type, Other's name, elapsed time, stations, lifts or the time cap; not
  the title, notes, day or time) and Save works each changed athlete's burn
  out again from the workout as it now stands, before it saves: the button
  reads "Working out the burn…", a burn the description or notes read off a
  watch stays as stated, and the new working is added to the notes as "Burn
  redone after edits". The session is saved with AI's burn marked as AI's
  (`kcalSource`), so editing it later from the Log does the same; a title or
  notes edit does not. A figure you type over AI's is yours and is never
  worked out again, and neither is a burn saved before sessions kept where
  theirs came from. If it cannot be worked out again (the estimator is
  unreachable, out of its day's calls, or from before this), the out-of-date
  figure is dropped rather than saved, the log estimates the burn instead, and
  a notice says so (`redoStaleBurns` in `lib/workout-burn.ts`, through
  `/api/workout-burn`, which shares the team's 60 workout AI calls a day).
  A session takes a time of day, which starts at the clock and can be cleared.
  Saving a lift heavier than any of that athlete's earlier sessions, or the
  same weight for more reps, says so: "New best: Back squat 195 lb × 5, up from
  185 lb × 5". Reps are the ones made, so a set whose final rep failed counts
  one fewer. Less weight for more reps is not a best, since nothing is
  carried up to a max. The server checks every earlier session, the session's own
  earlier version included, so saving an edit announces nothing it already held.
  What is typed and not saved yet is kept as a draft; see [Drafts](meal-estimates.md#drafts).
