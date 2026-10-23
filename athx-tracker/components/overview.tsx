"use client";

import { Dumbbell, Target } from "lucide-react";
import { Fuel } from "@/components/fuel";
import {
  ATHLETES,
  METCON,
  categoryName,
  estimateBurn,
  formatTimeOrDash,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import { daysBetween, dayToDate, isWorkout, weekStart } from "@/lib/client";

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

const daysLogged = (workouts: { athlete: string; day: string }[], who: string) =>
  workouts.filter((w) => w.athlete === who).map((w) => w.day);

export function Overview({
  records,
  settings,
  today,
  journalTotal,
  loadingAll,
  onLoadAll,
}: {
  records: RecordItem[];
  settings: Settings;
  today: string;
  journalTotal: number;
  loadingAll?: boolean;
  onLoadAll?: () => void;
}) {
  const countdown = daysBetween(today, settings.eventDate);
  const thisWeek = weekStart(today);
  const workouts = records.filter(isWorkout);
  const weekWorkouts = workouts.filter((w) => weekStart(w.day) === thisWeek);
  const lastSession = workouts.find((w) => w.day <= today) ?? workouts[0];
  // The log shows every session's burn; the panel that puts one session in
  // front of you was the one place leaving it out.
  const lastBurn =
    lastSession && lastSession.athlete !== "team"
      ? estimateBurn(
          lastSession,
          (settings.bodyweight ?? { hippos: 0, gators: 0 })[lastSession.athlete],
        )
      : null;

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

      <Fuel
        records={records}
        settings={settings}
        today={today}
        journalTotal={journalTotal}
        loadingAll={loadingAll}
        onLoadAll={onLoadAll}
      />

      {lastSession ? (
        <Panel title="Last session" icon={<Target className="size-4 text-muted-foreground" />}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{lastSession.title}</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatTimeOrDash(lastSession.seconds)}
              {lastBurn !== null ? ` · ~${lastBurn} kcal` : ""}
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
