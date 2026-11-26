# How the figures are worked out

## Weights and older entries

Every weight is stored in kilograms and converted for display, so switching
lb/kg never rewrites a record. The switch sits at the top of every screen, starts
in pounds, and is saved with the settings, so both phones read the same unit.
Flipping it while Setup or a session form is open converts what is in their
boxes, typed or not, and keeps it. Opening an entry and saving it again keeps the
stored load exactly, rather than re-reading it from its rounded display.
Stations saved before sessions could mix carry no part or load: their part is
taken from the session's category (Endurance is endurance, anything else is
MetCon), and a missing time-cap flag reads as no. A station of your own saved
short of a target, from before such stations stopped taking one, keeps that
target through an edit; one saved at its target reads as having none. Entries
from before times of day have none and sort after the timed ones on their day;
settings from before dated targets, heights and birth years read as one set of
targets for every day and nothing given. No migration is needed.

## Calories burned

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

Calories in a session's Calories burned box are its burn instead, on any category:
typed from a watch or a machine, or filled by AI from the description (see
[Session](session.md)). They are kept as given, not rounded, and need no bodyweight
to show. AI's figure is worked out again when the workout it was for is edited,
and dropped for this estimate when it cannot be. Fuel still counts no training burn, typed or estimated, until a bodyweight
is known.

A Mixed session has no single MET, so `sessionMet` weights it by where the time
went: timed MetCon stations at 8, timed endurance at 9, and the untimed rest at
strength's 6 when there are lifts (otherwise at the MetCon's, or endurance's).
Every other category keeps its one figure, so no earlier burn changes.

## The full-workout scenario

`projectWorkout` in `lib/domain.ts` extends a part-finished workout to the whole thing:
observed time kept as measured, only unperformed work extended at the pace you actually
held at that station, plus a fatigue allowance. A station you never started is never
given another movement's pace, and one finished but never timed has no pace to offer, so
it declines rather than guessing.

It is worked out again from the stations, fatigue and transition already on the
session, not stored as a second figure that could drift. Reading a part-finished
session shows it as one line, on the log entry and under Today's sessions: the
estimated finish as a clock time, beside the time and the burn. A session with no
stations, no elapsed time, unfinished work that has no pace, or station times that
cannot fit the elapsed time shows nothing, not a zero. Logging still does not ask
for it.

## Resting energy and the balance

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
