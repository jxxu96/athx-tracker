"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Input } from "@/components/ui/input";
import { ATHLETES, type Macros, type RecordItem, type Settings } from "@/lib/domain";
import type { BodyweightHistory } from "@/lib/bodyweight";
import { addDays, dayToDate } from "@/lib/client";
import {
  athleteFuel,
  calorieTracking,
  energyBalance,
  formatAmount,
  fuelWindow,
  targetPercent,
  teamSessions,
  type AthleteFuel,
  type FuelAthlete,
  type FuelSpan,
} from "@/lib/fuel";
import type { JournalSummary } from "@/lib/summary";

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
type FuelView = FuelSpan | "day";

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
    return "Daily average across every day with a meal. The totals underneath are the whole stretch; spend is a day's average since the first entry.";
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
  const share = targetPercent(value, target);
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
          {share !== null ? <span className="text-muted-foreground"> · {share}%</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${share === null ? 0 : Math.min(100, share)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/** Estimates to the nearest ten, which is all the methods are worth. */
const tens = (kcal: number) => Math.round(kcal / 10) * 10;
const signed = (kcal: number) => (kcal > 0 ? `+${formatAmount(kcal)}` : formatAmount(kcal));

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
  const balance = energyBalance(fuel);
  const perDay = multi ? " a day" : "";
  return (
    <div role="group" aria-label={`${ATHLETES[athlete].name} fuel`} className="space-y-3">
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
      <div className="border-t pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Expenditure
        </p>
        {fuel.expenditure !== null && fuel.resting !== null ? (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              ~{formatAmount(tens(fuel.expenditure))}
              <span className="ml-1 text-sm font-normal text-muted-foreground">kcal{perDay}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Resting ~{formatAmount(tens(fuel.resting))} · training ~
              {formatAmount(tens(fuel.burned / fuel.expenditureDays))}
            </p>
            {balance !== null ? (
              <p className="mt-1 text-xs">
                <span className="text-muted-foreground">Balance </span>
                <span className="font-medium tabular-nums">
                  {signed(tens(balance))} kcal{perDay}
                </span>
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Everyday movement and digestion are not in this, so the real spend is higher.
            </p>
          </>
        ) : fuel.burnKnown ? (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              ~{formatAmount(fuel.burned)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">kcal</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Training only. Add a height and birth year in Setup to count resting energy too.
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Add a bodyweight in Setup to estimate calories burned.
          </p>
        )}
        {fuel.untimed > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {fuel.untimed} session{fuel.untimed === 1 ? "" : "s"} had no duration, so{" "}
            {fuel.untimed === 1 ? "it is" : "they are"} not in this burn.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function Fuel({
  records,
  settings,
  history,
  figures,
  today,
  onLoadDay,
  refresh,
}: {
  records: RecordItem[];
  settings: Settings;
  history: BodyweightHistory;
  /** Overall needs the whole journal; these are its figures. */
  figures: JournalSummary;
  today: string;
  onLoadDay: (day: string) => Promise<void>;
  refresh: number;
}) {
  const [span, setSpan] = useState<FuelView>("today");
  const [day, setDay] = useState(today);
  const [loaded, setLoaded] = useState({ day: "", refresh });
  const [dayError, setDayError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (span !== "day") return;
    let active = true;
    onLoadDay(day).then(() => {
      if (active) {
        setLoaded({ day, refresh });
        setDayError(null);
      }
    }).catch(() => {
      if (active) setDayError("Could not load this day. Check your connection and try again.");
    });
    return () => { active = false; };
  }, [span, day, onLoadDay, attempt, refresh]);
  const loadingDay = span === "day" && (loaded.day !== day || loaded.refresh !== refresh);
  const period = span === "day" ? "today" : span;
  const referenceDay = span === "day" ? day : today;
  const multi = span === "week" || span === "overall";
  const people = PEOPLE.map((athlete) => ({
    athlete,
    fuel:
      span === "overall"
        ? figures.overall[athlete]
        : athleteFuel(records, athlete, period, referenceDay, settings, history),
  }));
  const mealDays = (athlete: FuelAthlete) => {
    const window = fuelWindow(period, referenceDay);
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
  const together = span === "overall" ? figures.togetherOverall : teamSessions(records, period, referenceDay);
  const story = people
    .map((person) =>
      calorieTracking(ATHLETES[person.athlete].name, person.fuel, multi),
    )
    .join(". ");

  return (
    <CollapsibleCard
      name="Fuel"
      className="p-4 sm:p-5"
      heading={
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold group-data-[collapsed]:mb-0">
          <Flame className="size-4 text-muted-foreground" />
          Fuel
        </h2>
      }
      mini={loadingDay || (span === "day" && dayError) ? null : `${story}.`}
    >
      <div
        role="group"
        aria-label="Fuel range"
        className="mb-3 grid grid-cols-5 rounded-full bg-muted p-0.5"
      >
        {SPANS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.name}
            aria-pressed={span === item.id}
            onClick={() => setSpan(item.id)}
            className="rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm sm:text-xs"
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Pick day for fuel"
          aria-pressed={span === "day"}
          onClick={() => {
            setSpan("day");
            setLoaded({ day: "", refresh });
            setDayError(null);
            setAttempt((current) => current + 1);
          }}
          className="rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm sm:text-xs"
        >
          Pick day
        </button>
      </div>
      {span === "day" ? (
        <div className="mb-3 flex items-center gap-3">
          <label htmlFor="fuel-day" className="shrink-0 text-xs font-medium">Day</label>
          <Input
            id="fuel-day"
            aria-label="Fuel day"
            type="date"
            min="0001-01-01"
            max={today}
            value={day}
            onChange={(event) => {
              if (!event.target.value || !event.target.validity.valid) return;
              setDay(event.target.value);
              setLoaded({ day: "", refresh });
              setDayError(null);
            }}
            className="w-auto max-w-full"
          />
        </div>
      ) : null}
      <p className="mb-3 text-xs text-muted-foreground">
        {span === "day"
          ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(dayToDate(day))}, against that day's targets.`
          : spanNote(span, today)}
      </p>
      {span === "day" && dayError ? (
        <div role="alert" className="text-sm">
          <p>{dayError}</p>
          <button
            type="button"
            className="mt-2 text-xs font-medium underline"
            onClick={() => { setDayError(null); setLoaded({ day: "", refresh }); setAttempt((current) => current + 1); }}
          >Try again</button>
        </div>
      ) : loadingDay ? (
        <p role="status" className="text-sm text-muted-foreground">Loading this day…</p>
      ) : (
        <>
          <p className="mb-4 text-sm">{story}.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            {people.map((person) => (
              <AthleteFuelCard
                key={person.athlete}
                athlete={person.athlete}
                fuel={person.fuel}
                span={period}
                today={today}
                mealDays={mealDays(person.athlete)}
              />
            ))}
          </div>
          {together > 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {together} together session{together === 1 ? "" : "s"} not included.
              A shared session has no single bodyweight.
            </p>
          ) : null}
        </>
      )}
    </CollapsibleCard>
  );
}
