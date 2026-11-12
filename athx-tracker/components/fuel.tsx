"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { CalorieBar, FUEL_OVER_HATCH, type CalorieSlice } from "@/components/calorie-bar";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Input } from "@/components/ui/input";
import { ATHLETES, type Macros, type RecordItem, type Settings } from "@/lib/domain";
import { bodyweightOn, type BodyweightHistory } from "@/lib/bodyweight";
import { addDays, dayToDate } from "@/lib/client";
import {
  athleteFuel,
  barMarkPercent,
  calorieSlices,
  energyBalance,
  formatAmount,
  fuelWindow,
  inFuelWindow,
  softProteinGoal,
  targetPercent,
  teamSessions,
  type AthleteFuel,
  type FuelAthlete,
  type FuelDateRange,
  type FuelSpan,
  type MacroShares,
} from "@/lib/fuel";
import { needsFetch } from "@/lib/session-calendar";
import type { JournalSummary } from "@/lib/summary";

const SPANS = [
  { id: "today", label: "Today", name: "Fuel for today" },
  { id: "yesterday", label: "Yesterday", name: "Fuel for yesterday" },
  { id: "week", label: "7 days", name: "Fuel for the last 7 days" },
  { id: "last-week", label: "Last Week", name: "Fuel for last week" },
  { id: "overall", label: "Overall", name: "Fuel overall" },
] as const satisfies readonly { id: FuelSpan; label: string; name: string }[];

const MACRONUTRIENTS = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const;

const MACRO_KEYS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  ...MACRONUTRIENTS,
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

function dayCaption(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayToDate(day));
}

function foldedFuel(name: string, fuel: AthleteFuel, average: boolean) {
  if (fuel.daysWithMeals === 0) return `${name} —`;
  const eaten = formatAmount(fuel.shown.calories);
  const target = fuel.dailyTarget.calories;
  const figure = target > 0 ? `${eaten} / ${formatAmount(target)} kcal` : `${eaten} kcal`;
  return `${name} ${average ? "avg " : ""}${figure}`;
}

/**
 * Each macro's slice of the calorie bar is a tint of the athlete's colour,
 * strongest first in the order the rows run, so the rows below read as its key.
 * Tinted toward white in both themes: toward a dark card the faintest slice
 * sank into the empty track.
 */
const SLICE_STRENGTH = { protein: 100, carbs: 65, fat: 35 } as const;
const sliceColor = (color: string, key: keyof MacroShares) =>
  `color-mix(in srgb, ${color} ${SLICE_STRENGTH[key]}%, white)`;
/** Calories no macro accounts for: grey, so it reads as none of them. */
const OTHER_SLICE = "color-mix(in srgb, var(--muted-foreground) 40%, var(--card))";
function calorieBar(shares: MacroShares, color: string): CalorieSlice[] {
  const sizes = calorieSlices(shares);
  const slices: CalorieSlice[] = [
    ...MACRONUTRIENTS.map(({ key, label }) => ({
      key,
      label,
      share: shares[key],
      size: sizes[key],
      color: sliceColor(color, key),
    })),
    { key: "other", label: "Other", share: sizes.other, size: sizes.other, color: OTHER_SLICE },
  ];
  return slices.filter(({ size }) => size > 0.000001);
}

function MacroRow({
  label,
  unit,
  value,
  target,
  color,
  average,
  mark,
  slices,
  calorieShare,
}: {
  label: string;
  unit: string;
  value: number;
  target: number;
  color: string;
  average: boolean;
  /** A tick on the bar, as a percent of the target. Null draws none. */
  mark: { at: number; label: string } | null;
  /** The calorie bar's split by macro. Null fills it in one colour. */
  slices: CalorieSlice[] | null;
  /** This macro's estimated share of the calories logged, with its slice's colour. */
  calorieShare: { percent: number; color: string } | null;
}) {
  const share = targetPercent(value, target);
  // Past the target the bar stands for everything eaten, so the target moves
  // in from the end, a tick marks it, and the part beyond it is striped. It
  // used to stop at the end, and 130% looked the same as 100%.
  const over = share !== null && share > 100;
  const targetAt = over ? (100 / share) * 100 : 100;
  const fill = share === null ? 0 : over ? 100 : share;
  return (
    <div className="space-y-1.5">
      {/* Too narrow for both, the figures drop to their own line rather than break mid-phrase. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="flex items-baseline gap-2 whitespace-nowrap text-muted-foreground">
          {label}
          {calorieShare ? (
            <span title="Estimated share of logged calories" className="inline-flex items-center gap-1 tabular-nums">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 self-center rounded-[2px]"
                style={{ background: calorieShare.color }}
              />
              ~{calorieShare.percent}% of kcal
            </span>
          ) : null}
        </span>
        <span className="ml-auto whitespace-nowrap text-right font-medium tabular-nums">
          {average ? <span className="font-normal text-muted-foreground">avg </span> : null}
          {formatAmount(value)}
          {target > 0 ? (
            <span className="text-muted-foreground"> / {formatAmount(target)}</span>
          ) : null}
          <span className="text-muted-foreground"> {unit}</span>
          {share !== null ? <span className="text-muted-foreground"> · {share}% of target</span> : null}
        </span>
      </div>
      {slices ? (
        <CalorieBar slices={slices} fill={share === null ? 100 : fill} targetAt={over ? targetAt : null} />
      ) : (
        <div className="relative h-1.5">
          <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${fill}%`, background: color }}
            />
            {over ? (
              <div
                data-fuel-over=""
                className="absolute inset-y-0 right-0"
                style={{ left: `${targetAt}%`, backgroundImage: FUEL_OVER_HATCH }}
              />
            ) : null}
          </div>
          {over ? (
            <span
              aria-hidden="true"
              data-fuel-target=""
              className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
              style={{ left: `${targetAt}%` }}
            />
          ) : null}
          {mark ? (
            <span
              role="img"
              aria-label={mark.label}
              title={mark.label}
              className="absolute top-1/2 z-10 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
              // A mark is placed against the target, which has moved in.
              style={{ left: `${(mark.at * targetAt) / 100}%` }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Estimates to the nearest ten, which is all the methods are worth. */
const tens = (kcal: number) => Math.round(kcal / 10) * 10;
const signed = (kcal: number) => (kcal > 0 ? `+${formatAmount(kcal)}` : formatAmount(kcal));

/** One dot per day of the week, marked when it has a meal. */
function WeekDots({
  start,
  days,
  color,
}: {
  start: string;
  days: Set<string>;
  color: string;
}) {
  return (
    <div aria-hidden="true" className="grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        const logged = days.has(day);
        return (
          <div key={day} className="text-center">
            <div
              className={`mx-auto size-2 rounded-full ${logged ? "" : "bg-muted"}`}
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
  weekStart,
  mealDays,
  softProtein,
}: {
  athlete: FuelAthlete;
  fuel: AthleteFuel;
  weekStart: string | null;
  mealDays: Set<string>;
  /** Grams. Null when this person has no soft protein line, or no weight to take it from. */
  softProtein: number | null;
}) {
  const multi = fuel.spanDays !== 1;
  const logged =
    fuel.spanDays !== null
      ? `${fuel.daysWithMeals} of ${fuel.spanDays} days`
      : `${fuel.daysWithMeals} day${fuel.daysWithMeals === 1 ? "" : "s"}`;
  const balance = energyBalance(fuel);
  const calorieShares = fuel.macroCalorieShares;
  const color = ATHLETES[athlete].color;
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
      {weekStart ? (
        <WeekDots start={weekStart} days={mealDays} color={ATHLETES[athlete].color} />
      ) : null}
      {fuel.daysWithMeals === 0 ? (
        <p className="text-xs text-muted-foreground">No meals logged.</p>
      ) : (
        <>
          {MACRO_KEYS.map(({ key, label, unit }) => {
            const at = key === "protein" && softProtein !== null
              ? barMarkPercent(softProtein, fuel.dailyTarget.protein)
              : null;
            const mark = at === null || softProtein === null
              ? null
              : { at, label: `Soft protein goal, ${formatAmount(softProtein)} g` };
            return (
              <MacroRow
                key={key}
                label={label}
                unit={unit}
                value={fuel.shown[key]}
                target={fuel.dailyTarget[key]}
                color={color}
                average={multi}
                mark={mark}
                slices={key === "calories" && calorieShares ? calorieBar(calorieShares, color) : null}
                calorieShare={
                  key !== "calories" && calorieShares
                    ? { percent: Math.round(calorieShares[key]), color: sliceColor(color, key) }
                    : null
                }
              />
            );
          })}
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
  onLoadWindow,
  heldFrom,
  refresh,
}: {
  records: RecordItem[];
  settings: Settings;
  history: BodyweightHistory;
  /** Overall needs the whole journal; these are its figures. */
  figures: JournalSummary;
  today: string;
  onLoadWindow: (from: string, to: string, signal: AbortSignal) => Promise<void>;
  heldFrom: string | null;
  refresh: number;
}) {
  const [span, setSpan] = useState<FuelView>("today");
  const [day, setDay] = useState(today);
  const [endDay, setEndDay] = useState("");
  const [custom, setCustom] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; failed: boolean }>();

  const period: FuelSpan | FuelDateRange = span === "day"
    ? { start: day, end: custom ? endDay : day }
    : span;
  const window = fuelWindow(period, today);
  const { start, end } = window;
  const multi = start !== end;
  const weekly = span === "week" || span === "last-week";
  const fetchWindow = start !== null && (
    (span === "day" && heldFrom !== null) || (weekly && needsFetch(heldFrom, start))
  );
  const loadKey = fetchWindow ? `${start}/${end}/${refresh}/${attempt}` : null;
  useEffect(() => {
    if (start === null || loadKey === null) return;
    const controller = new AbortController();
    onLoadWindow(start, end, controller.signal).then(() => {
      if (!controller.signal.aborted) setLoaded({ key: loadKey, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ key: loadKey, failed: true });
    });
    return () => controller.abort();
  }, [start, end, loadKey, onLoadWindow]);
  const loading = loadKey !== null && loaded?.key !== loadKey;
  const loadError = loadKey !== null && loaded?.key === loadKey && loaded.failed;
  const selection = start === end ? "day" : "range";
  const people = PEOPLE.map((athlete) => ({
    athlete,
    fuel:
      span === "overall"
        ? figures.overall[athlete]
        : athleteFuel(records, athlete, period, today, settings, history),
    softProtein: softProteinGoal(athlete, bodyweightOn(history, athlete, end)),
  }));
  const mealDays = (athlete: FuelAthlete) =>
    new Set(
      records
        .filter((record) => record.kind === "meal" && record.athlete === athlete && inFuelWindow(record.day, window))
        .map((record) => record.day),
    );
  const together = span === "overall" ? figures.togetherOverall : teamSessions(records, period, today);
  let caption: string | null = null;
  if (span === "day") caption = multi ? `${dayCaption(day)} to ${dayCaption(end)}` : dayCaption(day);
  if (weekly && start !== null) caption = `${shortDate(start)} to ${shortDate(end)}, complete days`;
  if (span === "overall") caption = `Every complete day, up to ${shortDate(end)}`;

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
      mini={
        loading || loadError
          ? null
          : people
              .map((person) => foldedFuel(ATHLETES[person.athlete].name, person.fuel, multi))
              .join(" · ")
      }
    >
      <div
        role="group"
        aria-label="Fuel range"
        className="mb-3 grid grid-cols-2 rounded-xl bg-muted p-0.5 min-[420px]:grid-cols-6 min-[420px]:rounded-full"
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
            setAttempt((current) => current + 1);
          }}
          className="rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm sm:text-xs"
        >
          Pick day
        </button>
      </div>
      {span === "day" ? (
        <div className="mb-3 space-y-2">
          <label className="flex w-fit items-center gap-2 py-1 text-xs font-medium">
            <input
              type="checkbox"
              checked={custom}
              onChange={(event) => {
                if (event.target.checked && endDay < day) setEndDay(day);
                setCustom(event.target.checked);
              }}
            />
            Custom window
          </label>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fuel-day" className="text-xs font-medium">{custom ? "Start" : "Day"}</label>
              <Input
                id="fuel-day"
                aria-label={custom ? "Start date" : "Fuel day"}
                type="date"
                min="0001-01-01"
                max={today}
                value={day}
                onChange={(event) => {
                  if (!event.target.value || !event.target.validity.valid) return;
                  const next = event.target.value;
                  setDay(next);
                  if (custom && endDay < next) setEndDay(next);
                }}
                className="w-auto max-w-full"
              />
            </div>
            {custom ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="fuel-end" className="text-xs font-medium">End</label>
                <Input
                  id="fuel-end"
                  aria-label="End date"
                  type="date"
                  min={day}
                  max={today}
                  value={endDay}
                  onChange={(event) => {
                    if (event.target.value && event.target.validity.valid) setEndDay(event.target.value);
                  }}
                  className="w-auto max-w-full"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {caption ? <p className="mb-3 text-xs text-muted-foreground">{caption}</p> : null}
      {loadError ? (
        <div role="alert" className="text-sm">
          <p>Could not load this {selection}. Check your connection and try again.</p>
          <button
            type="button"
            className="mt-2 text-xs font-medium underline"
            onClick={() => setAttempt((current) => current + 1)}
          >Try again</button>
        </div>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading this {selection}…</p>
      ) : (
        <>
          {/* Side by side only from md: narrower, a macro row has no room for its calorie share. */}
          <div className="grid gap-5 md:grid-cols-2">
            {people.map((person) => (
              <AthleteFuelCard
                key={person.athlete}
                athlete={person.athlete}
                fuel={person.fuel}
                weekStart={weekly ? start : null}
                mealDays={mealDays(person.athlete)}
                softProtein={person.softProtein}
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
