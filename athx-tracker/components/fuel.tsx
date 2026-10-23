"use client";

import { useState } from "react";
import { Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATHLETES, type Macros, type RecordItem, type Settings } from "@/lib/domain";
import { addDays, dayToDate } from "@/lib/client";
import {
  athleteFuel,
  calorieTracking,
  formatAmount,
  fuelWindow,
  gapLabel,
  targetGap,
  teamSessions,
  type AthleteFuel,
  type FuelAthlete,
  type FuelSpan,
} from "@/lib/fuel";

const SPANS = [
  { id: "today", label: "Today", name: "Fuel for today" },
  { id: "yesterday", label: "Yesterday", name: "Fuel for yesterday" },
  { id: "week", label: "7 days", name: "Fuel for the last 7 days" },
  { id: "overall", label: "Overall", name: "Fuel overall" },
] as const satisfies readonly { id: FuelSpan; label: string; name: string }[];

const MACRO_KEYS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

const PEOPLE = ["hippos", "gators"] as const;

function shortDate(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayToDate(day));
}

function weekdayLetter(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "narrow",
    timeZone: "UTC",
  }).format(dayToDate(day));
}

function spanNote(span: FuelSpan, today: string) {
  if (span === "today") return "Today, against the daily target.";
  if (span === "yesterday") return "Yesterday, against the daily target.";
  if (span === "overall") {
    return "Daily average across every day with a meal. The totals underneath are the whole stretch.";
  }
  const window = fuelWindow("week", today);
  return `${shortDate(window!.start)} to ${shortDate(window!.end)}. Daily average of days with a meal.`;
}

function MacroRow({
  label,
  unit,
  value,
  target,
  color,
  average,
}: {
  label: string;
  unit: string;
  value: number;
  target: number;
  color: string;
  average: boolean;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const gap = gapLabel(targetGap(value, target), unit);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right font-medium tabular-nums">
          {average ? <span className="font-normal text-muted-foreground">avg </span> : null}
          {formatAmount(value)}
          {target > 0 ? (
            <span className="text-muted-foreground"> / {formatAmount(target)}</span>
          ) : null}
          <span className="text-muted-foreground"> {unit}</span>
          {gap ? <span className="text-muted-foreground"> · {gap}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${target > 0 ? pct : 0}%`, background: color }}
        />
      </div>
    </div>
  );
}

function WeekDots({
  today,
  days,
  color,
}: {
  today: string;
  days: Set<string>;
  color: string;
}) {
  const start = addDays(today, -6);
  return (
    <div aria-hidden="true" className="grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        const logged = days.has(day);
        return (
          <div key={day} className="text-center">
            <div
              className={`mx-auto size-2 rounded-full ${logged ? "" : "bg-muted"} ${day === today ? "ring-2 ring-foreground/30" : ""}`}
              style={logged ? { background: color } : undefined}
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {weekdayLetter(day)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AthleteFuelCard({
  athlete,
  fuel,
  span,
  today,
  mealDays,
}: {
  athlete: FuelAthlete;
  fuel: AthleteFuel;
  span: FuelSpan;
  today: string;
  mealDays: Set<string>;
}) {
  const multi = span === "week" || span === "overall";
  const logged =
    span === "week"
      ? `${fuel.daysWithMeals} of 7 days`
      : `${fuel.daysWithMeals} day${fuel.daysWithMeals === 1 ? "" : "s"}`;
  const showNet = fuel.burnKnown && (fuel.daysWithMeals > 0 || fuel.sessions > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ background: ATHLETES[athlete].color }}
        />
        <p className="text-sm font-medium">{ATHLETES[athlete].name}</p>
      </div>
      {span === "week" ? (
        <WeekDots today={today} days={mealDays} color={ATHLETES[athlete].color} />
      ) : null}
      {fuel.daysWithMeals === 0 ? (
        <p className="text-xs text-muted-foreground">No meals logged.</p>
      ) : (
        <>
          {MACRO_KEYS.map(({ key, label, unit }) => (
            <MacroRow
              key={key}
              label={label}
              unit={unit}
              value={fuel.shown[key]}
              target={fuel.dailyTarget[key]}
              color={ATHLETES[athlete].color}
              average={multi}
            />
          ))}
          {multi ? (
            <p className="text-xs text-muted-foreground">
              {formatAmount(fuel.eaten.calories)} kcal eaten · {logged}
            </p>
          ) : null}
          {MACRO_KEYS.every(({ key }) => fuel.dailyTarget[key] === 0) ? (
            <p className="text-xs text-muted-foreground">
              No daily targets set yet. Add them in Setup.
            </p>
          ) : null}
        </>
      )}
      {showNet ? (
        <p className="text-xs">
          <span className="text-muted-foreground">Net </span>
          <span className="font-medium tabular-nums">
            {formatAmount(fuel.eaten.calories - fuel.burned)} kcal
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function Fuel({
  records,
  settings,
  today,
  journalTotal,
  loadingAll = false,
  onLoadAll,
}: {
  records: RecordItem[];
  settings: Settings;
  today: string;
  /** Rows in the journal, which can be more than what is loaded. */
  journalTotal: number;
  loadingAll?: boolean;
  /** Set when Overall would otherwise be only the recent slice. */
  onLoadAll?: () => void;
}) {
  const [span, setSpan] = useState<FuelSpan>("today");
  const multi = span === "week" || span === "overall";
  const weight = settings.bodyweight ?? { hippos: 0, gators: 0 };
  const people = PEOPLE.map((athlete) => ({
    athlete,
    fuel: athleteFuel(
      records,
      athlete,
      span,
      today,
      settings.targets[athlete],
      weight[athlete],
    ),
  }));
  const mealDays = (athlete: FuelAthlete) => {
    const window = fuelWindow(span, today);
    return new Set(
      records
        .filter(
          (record) =>
            record.kind === "meal" &&
            record.athlete === athlete &&
            (window === null || (record.day >= window.start && record.day <= window.end)),
        )
        .map((record) => record.day),
    );
  };
  const known = people.filter((person) => person.fuel.burnKnown);
  const burned = known.reduce((sum, person) => sum + person.fuel.burned, 0);
  const untimed = people.reduce((sum, person) => sum + person.fuel.untimed, 0);
  const together = teamSessions(records, span, today);
  const partial = span === "overall" && records.length < journalTotal;
  const story = people
    .map((person) =>
      calorieTracking(ATHLETES[person.athlete].name, person.fuel, multi),
    )
    .join(". ");

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Flame className="size-4 text-muted-foreground" />
          Fuel
        </h2>
      </div>
      <div
        role="group"
        aria-label="Fuel range"
        className="mb-3 grid grid-cols-4 rounded-full bg-muted p-0.5"
      >
        {SPANS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.name}
            aria-pressed={span === item.id}
            onClick={() => setSpan(item.id)}
            className="rounded-full px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm sm:text-xs"
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{spanNote(span, today)}</p>
      <p className="mb-4 text-sm">{story}.</p>
      {partial && onLoadAll ? (
        <div className="mb-4 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          <p>
            Overall is using the latest {formatAmount(records.length)} of{" "}
            {formatAmount(journalTotal)} entries.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={loadingAll}
            onClick={onLoadAll}
          >
            {loadingAll ? "Loading…" : "Include the full journal"}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {people.map((person) => (
          <AthleteFuelCard
            key={person.athlete}
            athlete={person.athlete}
            fuel={person.fuel}
            span={span}
            today={today}
            mealDays={mealDays(person.athlete)}
          />
        ))}
      </div>
      <div className="mt-4 border-t pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {known.length === PEOPLE.length ? "Total expenditure" : "Expenditure"}
        </p>
        {known.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Add a bodyweight in Setup to estimate calories burned.
          </p>
        ) : (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              ~{formatAmount(burned)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">kcal</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {people
                .map((person) =>
                  person.fuel.burnKnown
                    ? `${ATHLETES[person.athlete].name} ~${formatAmount(person.fuel.burned)}`
                    : `${ATHLETES[person.athlete].name} needs a bodyweight`,
                )
                .join(" · ")}
            </p>
          </>
        )}
        {untimed > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {untimed} session{untimed === 1 ? "" : "s"} had no duration, so{" "}
            {untimed === 1 ? "it is" : "they are"} not in this burn.
          </p>
        ) : null}
        {together > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {together} together session{together === 1 ? "" : "s"} not included.
            A shared session has no single bodyweight.
          </p>
        ) : null}
      </div>
    </section>
  );
}
