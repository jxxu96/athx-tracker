"use client";

import { Dumbbell, Target } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Fuel } from "@/components/fuel";
import { RaceEstimate, RaceProgress, raceLine } from "@/components/race-estimate";
import { zoneGoals } from "@/lib/race";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  METCON,
  categoryName,
  completionLine,
  distanceLine,
  metconLoadText,
  estimateBurn,
  formatTimeOrDash,
  scenarioLine,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import { bodyweightOn, type BodyweightHistory } from "@/lib/bodyweight";
import { addDays, daysBetween, dayToDate, isWorkout, weekStart } from "@/lib/client";
import type { JournalSummary } from "@/lib/summary";

function Panel({
  title,
  icon,
  mini,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  mini: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleCard
      name={title}
      mini={mini}
      className="p-4 sm:p-5"
      heading={
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold group-data-[collapsed]:mb-0">
          {icon}
          {title}
        </h2>
      }
    >
      {children}
    </CollapsibleCard>
  );
}

const daysLogged = (workouts: { athlete: string; day: string }[], who: string) =>
  workouts.filter((w) => w.athlete === who).map((w) => w.day);

// "Together" is the days you both logged something, not a third athlete.
const sessionCount = (
  workouts: { athlete: string; day: string }[],
  key: "hippos" | "gators" | "team",
) =>
  key === "team"
    ? [...new Set(daysLogged(workouts, "hippos"))].filter((day) =>
        daysLogged(workouts, "gators").includes(day),
      ).length
    : workouts.filter((w) => w.athlete === key).length;

export function Overview({
  records,
  settings,
  history,
  figures,
  today,
  onLoadFuelDay,
  fuelRefresh,
}: {
  records: RecordItem[];
  settings: Settings;
  history: BodyweightHistory;
  /** The whole-journal figures, which the recent slice alone cannot give. */
  figures: JournalSummary;
  today: string;
  onLoadFuelDay: (day: string) => Promise<void>;
  fuelRefresh: number;
}) {
  const countdown = daysBetween(today, settings.eventDate);
  const thisWeek = weekStart(today);
  const workouts = records.filter(isWorkout);
  const sevenDaysAgo = addDays(today, -6);
  // This week runs from Monday; the last 7 days roll, so early in the week they differ.
  const windows = [
    { label: "This week", workouts: workouts.filter((w) => weekStart(w.day) === thisWeek) },
    { label: "Last 7 D", workouts: workouts.filter((w) => w.day >= sevenDaysAgo && w.day <= today) },
  ];
  const lastSession = workouts.find((w) => w.day <= today) ?? workouts[0];
  // The log shows every session's burn; the panel that puts one session in
  // front of you was the one place leaving it out.
  const lastBurn =
    lastSession && lastSession.athlete !== "team"
      ? estimateBurn(lastSession, bodyweightOn(history, lastSession.athlete, lastSession.day))
      : null;
  const lastScenario = lastSession ? scenarioLine(lastSession) : null;
  const daysToGo = `${countdown >= 0 ? countdown : 0} ${countdown === 1 ? "day to go" : "days to go"}`;

  return (
    <div className="space-y-4">
      <CollapsibleCard
        name={settings.eventName}
        className="p-5 sm:p-6"
        heading={
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            {settings.eventName}
          </p>
        }
        mini={daysToGo}
      >
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
      </CollapsibleCard>

      <Fuel
        records={records}
        settings={settings}
        history={history}
        figures={figures}
        today={today}
        onLoadDay={onLoadFuelDay}
        refresh={fuelRefresh}
      />

      <CollapsibleCard
        name="Progress and race-day estimate"
        className="p-5 sm:p-6"
        mini={`Race-day estimate: ${raceLine(figures.race)}`}
      >
        <RaceProgress
          estimate={figures.race}
          start={figures.raceStart}
          goals={zoneGoals(settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets, settings.raceGoals)}
          today={today}
        />
        <RaceEstimate estimate={figures.race} placing={figures.placing} />
      </CollapsibleCard>

      <Panel
        title="Sessions"
        icon={<Dumbbell className="size-4 text-muted-foreground" />}
        mini={`${windows[0].label}: ${(["hippos", "gators", "team"] as const)
          .map((key) => `${ATHLETES[key].name} ${sessionCount(windows[0].workouts, key)}/${settings.weeklyTarget}`)
          .join(" · ")}`}
      >
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="w-1/4 pb-2 font-normal">
                <span className="sr-only">Athlete</span>
              </th>
              {windows.map((window) => (
                <th key={window.label} scope="col" className="pb-2 pl-3 font-normal">
                  {window.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["hippos", "gators", "team"] as const).map((key) => (
              <tr key={key}>
                <th scope="row" className="truncate py-1.5 text-xs font-normal text-muted-foreground">
                  {ATHLETES[key].name}
                </th>
                {windows.map((window) => {
                  const count = sessionCount(window.workouts, key);
                  const pct = Math.min(
                    100,
                    Math.round((count / settings.weeklyTarget) * 100),
                  );
                  return (
                    <td key={window.label} className="py-1.5 pl-3">
                      <div className="space-y-1.5">
                        <p className="text-lg font-semibold tabular-nums leading-none">
                          {count}
                          <span className="text-xs font-normal text-muted-foreground">
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
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t text-xs text-muted-foreground">
              <th scope="row" className="pt-2 font-normal">
                Logged
              </th>
              {windows.map((window) => (
                <td key={window.label} className="pt-2 pl-3 tabular-nums">
                  {window.workouts.length} session{window.workouts.length === 1 ? "" : "s"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </Panel>

      {lastSession ? (
        <Panel
          title="Last session"
          icon={<Target className="size-4 text-muted-foreground" />}
          mini={`${lastSession.title} · ${formatTimeOrDash(lastSession.seconds)} · ${lastSession.day}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{lastSession.title}</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatTimeOrDash(lastSession.seconds)}
              {lastBurn !== null ? ` · ~${lastBurn} kcal` : ""}
            </p>
          </div>
          {lastScenario ? (
            <p className="mt-1 text-xs text-muted-foreground">{lastScenario}</p>
          ) : null}
          {completionLine(lastSession) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {completionLine(lastSession)}
            </p>
          ) : null}
          {distanceLine(lastSession) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {distanceLine(lastSession)}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {ATHLETES[lastSession.athlete].name} · {categoryName(lastSession)} ·{" "}
            {lastSession.context === "pairs" ? "Pairs" : "Solo"} · {lastSession.day}
            {lastSession.time ? ` ${lastSession.time}` : ""}
          </p>
          {lastSession.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {lastSession.notes}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title="ATHX Lite running order"
        mini={`${METCON.length} stations, ${METCON[0].name} to ${METCON[METCON.length - 1].name}`}
      >
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
                <span className="block text-muted-foreground">
                  {metconLoadText(station, settings.weightUnit ?? "lb")}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
