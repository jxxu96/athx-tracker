"use client";

import { useState } from "react";
import { BatteryMedium } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DayButtons } from "@/components/workout-form";
import { athleteOutline } from "@/lib/athlete-outline";
import { addDays, dayToDate, formatDay, newId } from "@/lib/client";
import {
  ATHLETES,
  ENERGY_MAX,
  ENERGY_MIN,
  clockTime,
  type EnergyCheckIn,
  type RecordItem,
} from "@/lib/domain";
import { averageEnergy, energyDays, energyOn, formatEnergy } from "@/lib/energy-level";

type Person = "hippos" | "gators";

const PEOPLE = ["hippos", "gators"] as const;
const LEVELS = Array.from({ length: ENERGY_MAX - ENERGY_MIN + 1 }, (_, index) => ENERGY_MIN + index);
const weekday = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(dayToDate(day));

/**
 * The ten levels in one row, low to high, with what the ends mean under them,
 * so a 7 means the same thing in March as it did in November. The chosen one
 * takes the athlete's ring.
 */
export function EnergyLevels({
  athlete,
  label,
  value,
  disabled,
  onChoose,
}: {
  athlete: Person;
  label: string;
  value: number | null;
  disabled?: boolean;
  onChoose: (level: number) => void;
}) {
  return (
    <div>
      <div role="group" aria-label={label} aria-busy={disabled || undefined} className="grid grid-cols-10 gap-1">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={value === level}
            aria-label={`${level} out of ${ENERGY_MAX}`}
            disabled={disabled}
            onClick={() => onChoose(level)}
            {...(value === level ? athleteOutline(athlete, "accent") : {})}
            className="min-w-0 rounded-md border-2 border-border py-2 text-xs font-medium tabular-nums transition-colors disabled:opacity-60 aria-pressed:bg-accent aria-pressed:font-semibold"
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
 * How each athlete feels, out of 10, set with one tap and changed with
 * another, and the last seven days under it. One a day: a second tap replaces
 * the first rather than adding to it. Today is where it starts; the date
 * buttons reach a day that was missed. Once both of you have checked in
 * today, the box opens folded to that one line.
 */
export function Energy({
  records,
  today,
  onCheckIn,
}: {
  records: RecordItem[];
  today: string;
  onCheckIn: (record: EnergyCheckIn) => Promise<void>;
}) {
  // The level tapped while it is being saved. The row waits for it, so a
  // second tap cannot race the first and leave two for one day.
  const [pending, setPending] = useState<Record<Person, number | null>>({ hippos: null, gators: null });
  // Which day the rows set. A day that turned while the app was open
  // follows today rather than staying on yesterday.
  const [chosen, setChosen] = useState<{ day: string; asOf: string }>({ day: today, asOf: today });
  const day = chosen.asOf === today ? chosen.day : today;
  const onToday = day === today;
  const from = addDays(today, -6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));

  async function choose(athlete: Person, level: number) {
    const current = energyOn(records, athlete, day);
    if (current?.level === level) return;
    setPending((now) => ({ ...now, [athlete]: level }));
    try {
      await onCheckIn({
        id: current?.id ?? newId(),
        kind: "energy",
        athlete,
        day,
        // Today's is at the clock. Another day's keeps the time it had, and a
        // new one has none: the clock now is not when that day was felt.
        ...(onToday ? { time: clockTime() } : current?.time ? { time: current.time } : {}),
        level,
      });
    } catch {
      // The tracker has already said why; the row shows what is saved.
    } finally {
      setPending((now) => ({ ...now, [athlete]: null }));
    }
  }

  const todayLine = (athlete: Person) => {
    const level = energyOn(records, athlete, today)?.level;
    return `${ATHLETES[athlete].name} ${level ?? "—"}`;
  };
  const both = PEOPLE.every((athlete) => energyOn(records, athlete, today) !== null);
  // "Today", "Yesterday" or "Wed 4 Nov", and the same inside a sentence.
  const dayLabel = formatDay(day, today);
  const dayName = onToday ? "today" : day === addDays(today, -1) ? "yesterday" : `on ${dayLabel}`;

  return (
    <CollapsibleCard
      name="Energy"
      className="p-4 sm:p-5"
      defaultOpen={!both}
      mini={`Today: ${PEOPLE.map(todayLine).join(" · ")}`}
      heading={
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold group-data-[collapsed]:mb-0">
          <BatteryMedium className="size-4 text-muted-foreground" />
          Energy
        </h2>
      }
    >
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        How each of you feels, out of {ENERGY_MAX}. Tap again to change it.
      </p>
      <div className="mb-4">
        <DayButtons
          today={today}
          day={day}
          subject="Energy"
          onChange={(next) => setChosen({ day: next, asOf: today })}
        />
      </div>
      <div className="space-y-4">
        {PEOPLE.map((athlete) => {
          const saved = energyOn(records, athlete, day);
          return (
            <div key={athlete}>
              <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium" style={{ color: ATHLETES[athlete].ink }}>
                  {ATHLETES[athlete].name}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {saved
                    ? `${dayLabel} ${saved.level}/${ENERGY_MAX}${saved.time ? ` · ${saved.time}` : ""}`
                    : `Not logged ${dayName}`}
                </span>
              </p>
              <EnergyLevels
                athlete={athlete}
                label={`${ATHLETES[athlete].name} energy ${dayName}`}
                value={pending[athlete] ?? saved?.level ?? null}
                disabled={pending[athlete] !== null}
                onChoose={(level) => void choose(athlete, level)}
              />
            </div>
          );
        })}
      </div>
      <table className="mt-4 w-full table-fixed border-t text-center text-xs tabular-nums">
        <caption className="sr-only">Energy over the last 7 days, out of {ENERGY_MAX}</caption>
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
                    {level ?? (
                      <>
                        <span aria-hidden="true" className="text-muted-foreground">·</span>
                        <span className="sr-only">none</span>
                      </>
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
