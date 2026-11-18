# Log and Setup

- **Log** — everything logged, newest first and, inside a day, latest time of day
  first, filterable, with edit and delete, each session showing what it burned.
  Weigh-ins and energy check-ins are entries too, corrected where they stand:
  a check-in's level, timing, day and time, its timing following the time
  until one is tapped. It opens with the most
  recent entries and fetches the rest when asked, and draws a hundred at a time
  however many are loaded, so a journal years deep neither crosses the network
  nor reaches the screen all at once. What this phone has not sent yet is marked
  as waiting; see [Without a connection](offline.md).
- **Setup** — event name and date, weekly session target, each
  athlete's bodyweight, height and birth year, their daily macro targets, their
  lift targets, and food notes. The bodyweight is what makes calories burned
  possible; without it that figure is withheld. A new bodyweight saved here is a
  weigh-in dated today, not a change to every day: see [Calories burned](figures.md#calories-burned). Height
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
  Keyboard shortcuts are listed in Setup, grouped by where they work. The list
  is there to read: the keys are fixed, and the header switch still turns them
  on or off on a computer. ⌘E on a Mac, or Alt+E elsewhere, runs the estimator
  on the open form, Estimate macros on Meal and Fill workout with AI on
  Session, and it works with the cursor still in the description. ⌘S or Alt+S
  saves the open form, as Save meal or Save session would, from any field;
  while it is estimating or saving the keys do nothing, rather than open the
  browser's Save Page. Option on a Mac types accents and the Windows key
  belongs to the system, so neither is used.
  Setup is the gear at the right of the header, which leaves the bottom bar
  five tabs: Today, Session, Meal, Log and Progress. What is typed in Setup
  stays there on any other tab until it is saved or discarded, and the gear
  carries a dot meanwhile; a refresh, or a template saved from Meal, leaves it
  alone. The save bar sticks above the bottom bar, says whether anything is
  unsaved, and offers **Discard**, which reopens Setup from the settings as
  they are. The light and dark themes are set here, on each phone, and apply
  at once without Save; the browser's own bar takes the theme's background.

## The header

The days to go, Refresh, who you are logging for, the lb/kg switch, keyboard
shortcuts on a computer, and the Setup gear. Who you are logging for is kept
on each phone, since each of you carries your own: a phone opens on whoever
it last logged for, and on Hippos until it has chosen (`hooks/use-logging-for.ts`).
Each browser tab then keeps its own, so a meal for Gators started in a
second tab does not move one for Hippos in the first.
