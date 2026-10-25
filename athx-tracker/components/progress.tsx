"use client";

import { TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  formatWeight,
  type RecordItem,
  type Settings,
  type WeightUnit,
} from "@/lib/domain";
import { formatDay } from "@/lib/client";
import { formatAmount, targetPercent } from "@/lib/fuel";
import {
  liftProgress,
  shownGap,
  targetMeter,
  toGo,
  togetherLiftSessions,
  type LiftProgress,
  type ProgressAthlete,
  type TopSet,
} from "@/lib/progress";

const PEOPLE = ["hippos", "gators"] as const;

/**
 * The start's share of the meter is grey, so the athlete's colour is only what
 * has been gained since. A faded athlete colour vanished against the dark theme.
 */
const START_FILL = { background: "var(--muted-foreground)", opacity: 0.5 };

function Swatch({ color }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={color ? { background: color } : START_FILL}
    />
  );
}

function Stat({
  label,
  value,
  notes,
  swatch,
}: {
  label: string;
  value: string;
  notes: string[];
  swatch?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {swatch}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums sm:text-base">{value}</dd>
      {notes.map((note, index) => (
        <dd key={index} className="text-[11px] text-muted-foreground">
          {note}
        </dd>
      ))}
    </div>
  );
}

function Meter({ start, best, color }: { start: number; best: number; color: string }) {
  const gained = best > start;
  return (
    <div aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
      {start > 0 ? (
        <div
          className={gained ? "" : "rounded-r-full"}
          style={{ width: `${start}%`, ...START_FILL }}
        />
      ) : null}
      {gained ? (
        <div
          className="rounded-r-full"
          style={{ width: `${best - start}%`, background: color }}
        />
      ) : null}
    </div>
  );
}

function Lift({
  athlete,
  lift,
  unit,
  today,
}: {
  athlete: ProgressAthlete;
  lift: LiftProgress;
  unit: WeightUnit;
  today: string;
}) {
  const color = ATHLETES[athlete].color;
  const label = `${ATHLETES[athlete].name} ${lift.name.toLowerCase()}`;
  const { start, latest, best } = lift;

  // Four dashes say less than one line does.
  if (!start || !latest || !best)
    return (
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-4 first:pt-0 last:pb-0"
      >
        <h3 className="text-sm font-medium">{lift.name}</h3>
        <p className="text-xs text-muted-foreground">
          Not logged yet ·{" "}
          {lift.target > 0 ? `target ${formatWeight(lift.target, unit)}` : "no target"}
        </p>
      </div>
    );

  const meter = targetMeter(lift);
  const remaining = toGo(lift, unit);
  const share = targetPercent(best.kg, lift.target);
  const gained = shownGap(start.kg, best.kg, unit);
  const notes = (set: TopSet) => [formatDay(set.day, today), `${set.sets}×${set.reps}`];
  const summary = [
    gained > 0 ? `+${gained} ${unit} since start` : "",
    share !== null ? `${share}% of target` : "",
    `${lift.sessions} session${lift.sessions === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div role="group" aria-label={label} className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      <h3 className="text-sm font-medium">{lift.name}</h3>
      <dl className="grid grid-cols-4 gap-2">
        <Stat
          label="Start"
          value={formatWeight(start.kg, unit)}
          notes={notes(start)}
          swatch={meter ? <Swatch /> : null}
        />
        <Stat label="Latest" value={formatWeight(latest.kg, unit)} notes={notes(latest)} />
        <Stat
          label="Best"
          value={formatWeight(best.kg, unit)}
          notes={notes(best)}
          swatch={meter ? <Swatch color={color} /> : null}
        />
        <Stat
          label="Target"
          value={lift.target > 0 ? formatWeight(lift.target, unit) : "—"}
          notes={
            remaining === null
              ? ["Set in Setup"]
              : remaining <= 0
                ? ["Reached"]
                : [`${remaining} ${unit} to go`]
          }
        />
      </dl>
      {meter ? <Meter start={meter.start} best={meter.best} color={color} /> : null}
      <p className="text-xs text-muted-foreground">{summary}</p>
    </div>
  );
}

export function Progress({
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
  /** Set when only the recent slice is loaded, which can hide a first session. */
  onLoadAll?: () => void;
}) {
  const unit = settings.weightUnit ?? "lb";
  // Settings saved before lift targets existed have none stored.
  const targets = settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets;
  const together = togetherLiftSessions(records);

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-muted-foreground" />
          Main lifts
        </h2>
        <p className="text-xs text-muted-foreground">
          Each day counts as its heaviest set, in {unit}. Start is the first day a
          lift was logged, latest the most recent, and best the heaviest. Targets
          are set in Setup.
        </p>
        {records.length < journalTotal && onLoadAll ? (
          <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <p>
              Using the latest {formatAmount(records.length)} of{" "}
              {formatAmount(journalTotal)} entries, so an older session could change
              a start or a best.
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
      </section>

      {PEOPLE.map((athlete) => (
        <section
          key={athlete}
          aria-labelledby={`progress-${athlete}`}
          className="rounded-2xl border bg-card p-4 sm:p-5"
        >
          <h2
            id={`progress-${athlete}`}
            className="mb-4 flex items-center gap-2 text-sm font-semibold"
          >
            <span
              className="size-2.5 rounded-full"
              style={{ background: ATHLETES[athlete].color }}
            />
            {ATHLETES[athlete].name}
          </h2>
          <div className="divide-y">
            {liftProgress(records, athlete, targets[athlete]).map((lift) => (
              <Lift key={lift.key} athlete={athlete} lift={lift} unit={unit} today={today} />
            ))}
          </div>
        </section>
      ))}

      {together > 0 ? (
        <p className="text-xs text-muted-foreground">
          {together} together session{together === 1 ? "" : "s"} with these lifts{" "}
          {together === 1 ? "is" : "are"} not included. A shared session has no
          single athlete.
        </p>
      ) : null}
    </div>
  );
}
