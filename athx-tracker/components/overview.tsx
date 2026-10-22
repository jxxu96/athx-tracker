"use client";

import { Dumbbell, Flame, Target } from "lucide-react";
import {
  ATHLETES,
  METCON,
  categoryName,
  estimateBurn,
  formatTimeOrDash,
  sumMacros,
  type Macros,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import { daysBetween, dayToDate, isMeal, isWorkout, weekStart } from "@/lib/client";

const MACRO_KEYS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function MacroRow({
  label,
  unit,
  value,
  target,
  color,
}: {
  label: string;
  unit: string;
  value: number;
  target: number;
  color: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {Math.round(value)}
          {target > 0 ? (
            <span className="text-muted-foreground"> / {Math.round(target)}</span>
          ) : null}
          <span className="text-muted-foreground"> {unit}</span>
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

const daysLogged = (workouts: { athlete: string; day: string }[], who: string) =>
  workouts.filter((w) => w.athlete === who).map((w) => w.day);

export function Overview({
  records,
  settings,
  today,
}: {
  records: RecordItem[];
  settings: Settings;
  today: string;
}) {
  const countdown = daysBetween(today, settings.eventDate);
  const thisWeek = weekStart(today);
  const workouts = records.filter(isWorkout);
  const weekWorkouts = workouts.filter((w) => weekStart(w.day) === thisWeek);
  const lastSession = workouts.find((w) => w.day <= today) ?? workouts[0];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {settings.eventName}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
            {countdown >= 0 ? countdown : 0}
          </span>
          <span className="text-sm text-muted-foreground">
            {countdown === 1 ? "day to go" : "days to go"}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(dayToDate(settings.eventDate))}
        </p>
      </section>

      <Panel title="This week" icon={<Dumbbell className="size-4 text-muted-foreground" />}>
        <div className="grid grid-cols-3 gap-3">
          {(["hippos", "gators", "team"] as const).map((key) => {
            // "Together" is the days you both logged something, not a third athlete.
            const count =
              key === "team"
                ? [...new Set(daysLogged(weekWorkouts, "hippos"))].filter((day) =>
                    daysLogged(weekWorkouts, "gators").includes(day),
                  ).length
                : weekWorkouts.filter((w) => w.athlete === key).length;
            const pct = Math.min(
              100,
              Math.round((count / settings.weeklyTarget) * 100),
            );
            return (
              <div key={key} className="space-y-2">
                <p className="truncate text-xs text-muted-foreground">
                  {ATHLETES[key].name}
                </p>
                <p className="text-2xl font-semibold tabular-nums leading-none">
                  {count}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{settings.weeklyTarget}
                  </span>
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${pct}%`, background: ATHLETES[key].color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {weekWorkouts.length} session{weekWorkouts.length === 1 ? "" : "s"} logged
          since Monday.
        </p>
      </Panel>

      <Panel title="Today&apos;s fuel" icon={<Flame className="size-4 text-muted-foreground" />}>
        <div className="grid gap-5 sm:grid-cols-2">
          {(["hippos", "gators"] as const).map((key) => {
            const totals = sumMacros(
              records
                .filter(isMeal)
                .filter((m) => m.athlete === key && m.day === today),
            );
            const targets = settings.targets[key];
            const weightKg = (settings.bodyweight ?? { hippos: 0, gators: 0 })[key];
            const burned = workouts
              .filter((w) => w.athlete === key && w.day === today)
              .reduce((sum, w) => sum + (estimateBurn(w, weightKg) ?? 0), 0);
            const unset = MACRO_KEYS.every(({ key: macro }) => targets[macro] === 0);
            return (
              <div key={key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: ATHLETES[key].color }}
                  />
                  <p className="text-sm font-medium">{ATHLETES[key].name}</p>
                </div>
                {MACRO_KEYS.map(({ key: macro, label, unit }) => (
                  <MacroRow
                    key={macro}
                    label={label}
                    unit={unit}
                    value={totals[macro]}
                    target={targets[macro]}
                    color={ATHLETES[key].color}
                  />
                ))}
                {weightKg > 0 ? (
                  <div className="space-y-1 border-t pt-2.5 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-muted-foreground">Burned training</span>
                      <span className="font-medium tabular-nums">~{burned} kcal</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-muted-foreground">Net</span>
                      <span className="font-medium tabular-nums">
                        {Math.round(totals.calories - burned)} kcal
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="border-t pt-2.5 text-xs text-muted-foreground">
                    Add a bodyweight in Settings to estimate calories burned.
                  </p>
                )}
                {unset ? (
                  <p className="text-xs text-muted-foreground">
                    No daily targets set yet — add them in Settings.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>

      {lastSession ? (
        <Panel title="Last session" icon={<Target className="size-4 text-muted-foreground" />}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{lastSession.title}</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatTimeOrDash(lastSession.seconds)}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ATHLETES[lastSession.athlete].name} · {categoryName(lastSession)} ·{" "}
            {lastSession.context === "pairs" ? "Pairs" : "Solo"} · {lastSession.day}
          </p>
          {lastSession.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {lastSession.notes}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="ATHX Lite running order">
        <ol className="divide-y text-xs">
          {METCON.map((station, index) => (
            <li key={station.name} className="flex gap-3 py-2 first:pt-0 last:pb-0">
              <span className="w-4 shrink-0 tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {station.target} {station.unit} · {station.name}
                </span>
                <span className="block text-muted-foreground">{station.load}</span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
