"use client";

import { useState, useSyncExternalStore } from "react";
import { BatteryMedium } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Choice } from "@/components/meal-form";
import { DayButtons } from "@/components/workout-form";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { athleteOutline } from "@/lib/athlete-outline";
import { addDays, dayToDate, formatDay, newId } from "@/lib/client";
import {
  ATHLETES,
  ENERGY_MAX,
  ENERGY_MIN,
  ENERGY_TIMINGS,
  clockTime,
  type EnergyCheckIn,
  type EnergyTiming,
  type RecordItem,
} from "@/lib/domain";
import { averageEnergy, checkInsAt, energyAt, energyDays, formatEnergy } from "@/lib/energy-level";
import { energyTimingForTime } from "@/lib/meal-time";

type Person = "hippos" | "gators";

const PEOPLE = ["hippos", "gators"] as const;
/** The meal form's keys for the same sittings. */
const TIMING_SHORTCUTS = {
  b: "Breakfast",
  l: "Lunch",
  d: "Dinner",
} as const satisfies Record<string, EnergyTiming>;
/** How often an open card looks at the clock, so the timing turns within this long of 11:00 or 17:00. */
const CLOCK_CHECK_MS = 15_000;
/**
 * The clock, read again every few seconds and whenever the app comes back
 * into view. Read only at a render, a card left open over breakfast still
 * showed breakfast at lunch, with its level chosen, and the next tap
 * replaced breakfast rather than logging lunch. It redraws only when the
 * timing changes.
 */
function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, CLOCK_CHECK_MS);
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
  };
}
/** The server cannot know the phone's clock, so it renders with no timing chosen. */
const serverTiming = () => null;
const LEVELS = Array.from({ length: ENERGY_MAX - ENERGY_MIN + 1 }, (_, index) => ENERGY_MIN + index);
const weekday = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(dayToDate(day));

/**
 * The ten levels in one row, low to high, with what the ends mean under them,
 * so a 7 means the same thing in March as it did in November. The chosen one
 * takes the athlete's ring. With logs, a tap adds a check-in rather than
 * choosing one, so the buttons are actions, not toggles, and the ring only
 * marks the one being saved.
 */
export function EnergyLevels({
  athlete,
  label,
  value,
  disabled,
  logs = false,
  onChoose,
}: {
  athlete: Person;
  label: string;
  value: number | null;
  disabled?: boolean;
  logs?: boolean;
  onChoose: (level: number) => void;
}) {
  return (
    <div>
      <div role="group" aria-label={label} aria-busy={disabled || undefined} className="grid grid-cols-10 gap-1">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={logs ? undefined : value === level}
            data-chosen={value === level || undefined}
            aria-label={`${logs ? "Log " : ""}${level} out of ${ENERGY_MAX}`}
            disabled={disabled}
            onClick={() => onChoose(level)}
            {...(value === level ? athleteOutline(athlete, "accent") : {})}
            className="min-w-0 rounded-md border-2 border-border py-2 text-xs font-medium tabular-nums transition-colors disabled:opacity-60 data-[chosen]:bg-accent data-[chosen]:font-semibold"
          >
            {level}
          </button>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Exhausted</span>
        <span>Full of energy</span>
      </div>
    </div>
  );
}

/**
 * How each athlete feels, out of 10, at breakfast, lunch and dinner, and the
 * last seven days under it. Each tap logs one more check-in; a timing takes as
 * many as are logged, and a mistake is fixed or deleted in the Log. Today at
 * the clock's timing is where it starts, the way a meal picks its sitting; the
 * date and timing buttons, or B, L and D, reach another. Once both of you have
 * checked in at the clock's timing, the box opens folded to that one line.
 */
export function Energy({
  records,
  today,
  onCheckIn,
  shortcutsEnabled = false,
}: {
  records: RecordItem[];
  today: string;
  onCheckIn: (record: EnergyCheckIn) => Promise<void>;
  shortcutsEnabled?: boolean;
}) {
  // The level tapped while it is being saved, and where. The athlete's row
  // waits for it, so a double tap logs once, not twice.
  const [pending, setPending] = useState<Record<Person, { level: number; day: string; timing: EnergyTiming } | null>>({
    hippos: null,
    gators: null,
  });
  // Which day and timing the rows set; a null timing follows the clock. A day
  // that turned while the app was open follows today and the clock again,
  // rather than staying on yesterday.
  const [chosen, setChosen] = useState<{ day: string; timing: EnergyTiming | null; asOf: string }>({
    day: today,
    timing: null,
    asOf: today,
  });
  const fresh = chosen.asOf === today;
  const day = fresh ? chosen.day : today;
  const clockTiming = useSyncExternalStore<EnergyTiming | null>(
    subscribeClock,
    () => energyTimingForTime(new Date()),
    serverTiming,
  );
  const timing = (fresh ? chosen.timing : null) ?? clockTiming;
  const onToday = day === today;
  const from = addDays(today, -6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const choose = (next: { day?: string; timing?: EnergyTiming }) =>
    setChosen((now) => ({ ...(now.asOf === today ? now : { day: today, timing: null }), ...next, asOf: today }));

  async function check(athlete: Person, level: number) {
    if (!timing) return;
    setPending((now) => ({ ...now, [athlete]: { level, day, timing } }));
    try {
      await onCheckIn({
        id: newId(),
        kind: "energy",
        athlete,
        day,
        // Today at the clock's timing is at the clock. Any other has no time:
        // the clock now is not when that was felt.
        ...(onToday && timing === clockTiming ? { time: clockTime() } : {}),
        timing,
        level,
      });
    } catch {
      // The tracker has already said why; the row shows what is saved.
    } finally {
      setPending((now) => ({ ...now, [athlete]: null }));
    }
  }

  const todayLine = (athlete: Person) => {
    const level = timing ? energyAt(records, athlete, today, timing) : null;
    return `${ATHLETES[athlete].name} ${level === null ? "—" : formatEnergy(level)}`;
  };
  const both = clockTiming !== null &&
    PEOPLE.every((athlete) => energyAt(records, athlete, today, clockTiming) !== null);
  // "Today", "Yesterday" or "Wed 4 Nov", and the same inside a sentence.
  const dayLabel = formatDay(day, today);
  const dayName = onToday ? "today" : day === addDays(today, -1) ? "yesterday" : `on ${dayLabel}`;
  const atTiming = timing ? `at ${timing.toLowerCase()} ` : "";
  // One check-in as "Today 7/10 · 12:05"; several as their levels and mean.
  const windowLine = (athlete: Person) => {
    if (!timing) return "";
    const logged = checkInsAt(records, athlete, day, timing);
    if (logged.length === 0) return `Not logged ${atTiming}${dayName}`;
    if (logged.length === 1)
      return `${dayLabel} ${logged[0].level}/${ENERGY_MAX}${logged[0].time ? ` · ${logged[0].time}` : ""}`;
    const level = energyAt(records, athlete, day, timing) ?? 0;
    return `${dayLabel} ${logged.map((record) => record.level).join(", ")} · avg ${formatEnergy(level)}/${ENERGY_MAX}`;
  };

  useKeyboardShortcuts(shortcutsEnabled, TIMING_SHORTCUTS, (next) => choose({ timing: next }));
  useKeyboardShortcuts(shortcutsEnabled, { y: () => choose({ day: addDays(today, -1) }) }, (action) => action());

  return (
    <CollapsibleCard
      // Opened again, folded or not, once the phone's clock is known and
      // whenever it reaches the next timing, which is then the one to log.
      key={clockTiming ?? ""}
      name="Energy"
      className="p-4 sm:p-5"
      defaultOpen={!both}
      mini={`Today${timing ? ` at ${timing.toLowerCase()}` : ""}: ${PEOPLE.map(todayLine).join(" · ")}`}
      heading={
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold group-data-[collapsed]:mb-0">
          <BatteryMedium className="size-4 text-muted-foreground" />
          Energy
        </h2>
      }
    >
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        How each of you feels, out of {ENERGY_MAX}, at breakfast, lunch and dinner. Each tap logs one more; fix a
        mistake in the Log.
      </p>
      <div className="mb-4 space-y-3">
        <DayButtons today={today} day={day} subject="Energy" onChange={(next) => choose({ day: next })} />
        <Choice
          label="Timing"
          value={timing}
          onChange={(next) => choose({ timing: next })}
          options={ENERGY_TIMINGS.map((value) => ({ value, label: value }))}
        />
      </div>
      <div className="space-y-4">
        {PEOPLE.map((athlete) => {
          const waiting = pending[athlete];
          return (
            <div key={athlete}>
              <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium" style={{ color: ATHLETES[athlete].ink }}>
                  {ATHLETES[athlete].name}
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{windowLine(athlete)}</span>
              </p>
              <EnergyLevels
                athlete={athlete}
                label={`${ATHLETES[athlete].name} energy ${atTiming}${dayName}`}
                value={waiting && waiting.day === day && waiting.timing === timing ? waiting.level : null}
                disabled={waiting !== null || timing === null}
                logs
                onChoose={(level) => void check(athlete, level)}
              />
            </div>
          );
        })}
      </div>
      <table className="mt-4 w-full table-fixed border-t text-center text-xs tabular-nums">
        <caption className="sr-only">
          Energy over the last 7 days, out of {ENERGY_MAX}, each day the mean of its breakfast, lunch and dinner
        </caption>
        <thead>
          <tr className="text-[10px] text-muted-foreground">
            <th scope="col" className="w-16 pt-2.5 pb-1 text-left font-normal">
              Last 7 days
            </th>
            {days.map((day) => (
              <th
                key={day}
                scope="col"
                className={`pt-2.5 pb-1 font-normal ${day === today ? "font-semibold text-foreground" : ""}`}
              >
                {weekday(day)}
                {day === today ? <span className="sr-only"> (today)</span> : null}
              </th>
            ))}
            <th scope="col" className="pt-2.5 pb-1 font-normal">
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {PEOPLE.map((athlete) => {
            const { average } = averageEnergy(records, athlete, from, today);
            return (
              <tr key={athlete}>
                <th scope="row" className="truncate py-1 text-left font-normal text-muted-foreground">
                  {ATHLETES[athlete].name}
                </th>
                {energyDays(records, athlete, from, today).map(({ day, level }) => (
                  <td key={day} className="py-1">
                    {level === null ? (
                      <>
                        <span aria-hidden="true" className="text-muted-foreground">·</span>
                        <span className="sr-only">none</span>
                      </>
                    ) : (
                      formatEnergy(level)
                    )}
                  </td>
                ))}
                <td className="py-1 font-semibold">{average === null ? "—" : formatEnergy(average)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CollapsibleCard>
  );
}
