"use client";

import { Dumbbell } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Energy } from "@/components/energy";
import { Fuel } from "@/components/fuel";
import { RaceEstimate, RaceProgress, raceLine } from "@/components/race-estimate";
import { RequestLog } from "@/components/request-log";
import { SessionCalendar } from "@/components/session-calendar";
import { daysTrained } from "@/lib/session-calendar";
import { zoneGoals } from "@/lib/race";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  METCON,
  metconLoadText,
  type EnergyCheckIn,
  type FeatureRequest,
  type RecordItem,
  type Settings,
} from "@/lib/domain";
import type { BodyweightHistory } from "@/lib/bodyweight";
import { addDays, isWorkout, weekStart } from "@/lib/client";
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

export function Overview({
  records,
  settings,
  history,
  figures,
  today,
  onLoadFuelDay,
  fuelRefresh,
  heldFrom,
  onLoadSessions,
  onCheckIn,
  onSaveRequest,
  onDeleteRequest,
  shortcutsEnabled = false,
}: {
  records: RecordItem[];
  settings: Settings;
  history: BodyweightHistory;
  /** The whole-journal figures, which the recent slice alone cannot give. */
  figures: JournalSummary;
  today: string;
  onLoadFuelDay: (day: string) => Promise<void>;
  fuelRefresh: number;
  /** The oldest day the phone holds; null when it holds the whole journal. */
  heldFrom: string | null;
  onLoadSessions: (from: string, to: string) => Promise<void>;
  /** Today's energy for one athlete, tapped on its card. */
  onCheckIn: (record: EnergyCheckIn) => Promise<void>;
  /** An idea added or marked done on the request log. */
  onSaveRequest: (record: FeatureRequest) => Promise<void>;
  onDeleteRequest: (id: string) => Promise<void>;
  shortcutsEnabled?: boolean;
}) {
  const thisWeek = weekStart(today);
  const workouts = records.filter(isWorkout);
  const sevenDaysAgo = addDays(today, -6);
  // This week runs from Monday; the last 7 days roll, so early in the week they differ.
  const windows = [
    { label: "This week", workouts: workouts.filter((w) => weekStart(w.day) === thisWeek) },
    { label: "Last 7 D", workouts: workouts.filter((w) => w.day >= sevenDaysAgo && w.day <= today) },
  ];
  const unit = settings.weightUnit ?? "lb";
  // A target of days, so 7 at most, whatever older settings saved as sessions.
  const target = Math.min(7, settings.weeklyTarget);

  // The days to go are in the header now. Fuel is what gets checked most, so
  // it leads; Energy folds to a line once both of you have checked in.
  return (
    <div className="space-y-4">
      <Fuel
        records={records}
        settings={settings}
        history={history}
        figures={figures}
        today={today}
        onLoadDay={onLoadFuelDay}
        refresh={fuelRefresh}
      />

      <Energy records={records} today={today} onCheckIn={onCheckIn} shortcutsEnabled={shortcutsEnabled} />

      <CollapsibleCard
        name="Progress and race-day estimate"
        className="p-5 sm:p-6"
        mini={`Race-day estimate: ${raceLine(figures.race, unit)}`}
      >
        <RaceProgress
          estimate={figures.race}
          start={figures.raceStart}
          goals={zoneGoals(settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets, settings.raceGoals, unit)}
          today={today}
          unit={unit}
        />
        <RaceEstimate estimate={figures.race} placing={figures.placing} unit={unit} />
      </CollapsibleCard>

      <Panel
        title="Sessions"
        icon={<Dumbbell className="size-4 text-muted-foreground" />}
        mini={`${windows[0].label}: ${(["hippos", "gators", "team"] as const)
          .map((key) => `${ATHLETES[key].name} ${daysTrained(windows[0].workouts, key)}/${target}`)
          .join(" · ")} days`}
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
                  const count = daysTrained(window.workouts, key);
                  const pct = Math.min(
                    100,
                    Math.round((count / target) * 100),
                  );
                  return (
                    <td key={window.label} className="py-1.5 pl-3">
                      <div className="space-y-1.5">
                        <p className="text-lg font-semibold tabular-nums leading-none">
                          {count}
                          <span className="text-xs font-normal text-muted-foreground">
                            /{target} days
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
        <SessionCalendar
          records={records}
          history={history}
          today={today}
          unit={unit}
          heldFrom={heldFrom}
          onLoad={onLoadSessions}
          refresh={fuelRefresh}
        />
      </Panel>

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
                  {metconLoadText(station, unit)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <RequestLog
        records={records}
        today={today}
        onSave={onSaveRequest}
        onDelete={onDeleteRequest}
      />
    </div>
  );
}
