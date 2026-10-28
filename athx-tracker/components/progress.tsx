"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Benchmarks } from "@/components/benchmarks";
import { Creature, RUNNER_SIZE } from "@/components/creatures";
import { WeeklyReview } from "@/components/weekly-review";
import { Button } from "@/components/ui/button";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  PROGRESS_LIFTS,
  formatWeight,
  fromKilograms,
  type RecordItem,
  type Settings,
  type WeightUnit,
} from "@/lib/domain";
import type { BodyweightHistory } from "@/lib/bodyweight";
import { formatDay } from "@/lib/client";
import { formatAmount, targetPercent } from "@/lib/fuel";
import { wearsProteinBagel } from "@/lib/protein-week";
import type { JournalSummary } from "@/lib/summary";
import {
  liftTotal,
  progressMarks,
  TOTAL_LIFTS,
  shownGap,
  toGo,
  VOLUME_WEEKS,
  type LiftProgress,
  type LiftTotal,
  leaderLanes,
  type ProgressAthlete,
  type ProgressBar,
  type ProgressMark,
  type TopSet,
} from "@/lib/progress";

const PEOPLE = ["hippos", "gators"] as const;

/**
 * Start is grey. Latest and best take the athlete's colour, and the target is
 * an open ring. A faded athlete colour vanished against the dark theme.
 */
const START_FILL = { background: "var(--muted-foreground)", opacity: 0.5 };

function Swatch({ color, ring = false }: { color?: string; ring?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={ring ? "size-2 shrink-0 rounded-full border-2" : "size-2 shrink-0 rounded-full"}
      style={ring ? { borderColor: color } : color ? { background: color } : START_FILL}
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
    <div className="min-w-0 pr-2">
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

const MARK_LAYER: Record<ProgressMark, number> = { target: 1, start: 2, latest: 3, best: 4 };

function Mark({ kind, at, color }: { kind: ProgressMark; at: number; color: string }) {
  const place = {
    left: `${at}%`,
    zIndex: MARK_LAYER[kind],
  };
  if (kind === "target") {
    return (
      <span
        data-progress-mark="target"
        className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-transparent"
        style={{ ...place, borderColor: color }}
      />
    );
  }
  if (kind === "start") {
    return (
      <span
        data-progress-mark="start"
        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ ...place, ...START_FILL }}
      />
    );
  }
  return (
    <span
      data-progress-mark={kind}
      className={
        kind === "best"
          ? "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
          : "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
      }
      style={{ ...place, background: color }}
    />
  );
}

/** Each mark's figure below the bar, in the order of the four columns. */
const COLUMN: Record<ProgressMark, number> = { start: 0, latest: 1, best: 2, target: 3 };
/** The line sits this far down the bar; leaders turn in lanes below it. */
const LINE_Y = 10;
const LANE_Y = (lane: number) => LINE_Y + 8 + lane * 5;
const BAR_HEIGHT = LANE_Y(3) + 12;

/** Along the line, which is inset 8px from each side so end marks stay whole. */
const alongLine = (at: number) => `calc(8px + (100% - 16px) * ${at / 100})`;
/** A column's swatch, at the left of each quarter of the row. */
const atColumn = (column: number) => `calc(25% * ${column} + 4px)`;

function Leader({
  from,
  to,
  lane,
  color,
  origin = LINE_Y,
}: {
  from: string;
  to: string;
  lane: number;
  color: string;
  /** Where the bar line sits. Leaders keep their drop below it. */
  origin?: number;
}) {
  const drop = origin - LINE_Y;
  const y = LANE_Y(lane) + drop;
  const line = { borderColor: color, opacity: 0.6 };
  return (
    <>
      <span
        className="absolute w-0 border-l"
        style={{ ...line, left: from, top: origin, height: y - origin }}
      />
      <span
        className="absolute h-0 border-t"
        style={{
          ...line,
          left: `min(${from}, ${to})`,
          width: `calc(max(${from}, ${to}) - min(${from}, ${to}))`,
          top: y,
        }}
      />
      <span
        className="absolute w-0 border-l"
        style={{ ...line, left: to, top: y, height: BAR_HEIGHT + drop - y }}
      />
    </>
  );
}

/**
 * The figures on a scale fitted to them, with round weights marked along the
 * line. With leaders, each mark has a line down to its figure in the row below.
 */
function Bar({
  bar,
  color,
  unit,
  leaders = false,
  runner,
  bagel = false,
}: {
  bar: ProgressBar;
  color: string;
  unit: WeightUnit;
  leaders?: boolean;
  /** Whose creature runs this line. Omitted, the line is only the marks. */
  runner?: ProgressAthlete;
  /** Bagel on the head. Only set after a missed protein week, and only Mon–Wed. */
  bagel?: boolean;
}) {
  const lanes = leaderLanes(
    bar.marks.map((mark) => ({ from: mark.at, to: COLUMN[mark.key] * 25 + 2 })),
  );
  const last = bar.ticks.length - 1;
  // The creature stands on the line, so the line moves down to make room.
  const origin = runner ? RUNNER_SIZE : LINE_Y;
  const height = (leaders ? BAR_HEIGHT : LINE_Y * 2) + (origin - LINE_Y);
  return (
    <div aria-hidden="true">
      <div className="relative h-4 text-[10px] leading-4 text-muted-foreground tabular-nums">
        {bar.ticks.map((tick, index) => (
          <span
            key={tick.value}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: alongLine(tick.at) }}
          >
            {index === last ? `${tick.value} ${unit}` : tick.value}
          </span>
        ))}
      </div>
      <div className="relative" style={{ height }}>
        {runner ? (
          <div
            className="athx-runner-track pointer-events-none absolute inset-x-2 overflow-hidden"
            style={{ top: origin - RUNNER_SIZE - 2, height: RUNNER_SIZE + 2 }}
            data-runner={runner}
            data-bagel={bagel ? "true" : "false"}
          >
            <Creature kind={runner} bagel={bagel} />
          </div>
        ) : null}
        <div
          className="absolute inset-x-2 h-0.5 -translate-y-1/2 rounded-full bg-muted"
          style={{ top: origin }}
        />
        {bar.ticks.map((tick) => (
          <span
            key={tick.value}
            data-progress-tick
            className="absolute h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/40"
            style={{ left: alongLine(tick.at), top: origin }}
          />
        ))}
        {leaders
          ? bar.marks.map((mark, index) => (
              <Leader
                key={mark.key}
                from={alongLine(mark.at)}
                to={atColumn(COLUMN[mark.key])}
                lane={lanes[index]}
                color={mark.key === "start" ? "var(--muted-foreground)" : color}
                origin={origin}
              />
            ))
          : null}
        <div className="absolute inset-x-2 h-0" style={{ top: origin }}>
          {bar.marks.map((mark) => (
            <Mark key={mark.key} kind={mark.key} at={mark.at} color={color} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The screen unit, with kilograms beside it when the screen is in pounds. */
function targetNotes(targetKg: number, bestKg: number | null, unit: WeightUnit) {
  const notes: string[] = [];
  if (unit !== "kg" && targetKg > 0) notes.push(formatWeight(targetKg, "kg"));
  if (!(targetKg > 0)) {
    notes.push("Set in Setup");
    return notes;
  }
  if (bestKg === null) return notes;
  const gap = toGo(
    { best: { day: "", kg: bestKg, sets: 1, reps: 1 }, target: targetKg },
    unit,
  );
  if (gap === null) return notes;
  if (gap <= 0) {
    notes.push("Reached");
    return notes;
  }
  notes.push(`${gap} ${unit} to go`);
  if (unit !== "kg") notes.push(`${shownGap(bestKg, targetKg, "kg")} kg`);
  return notes;
}

function asSet(kg: number | null): TopSet | null {
  return kg !== null && kg > 0 ? { day: "", kg, sets: 1, reps: 1 } : null;
}

function Total({
  athlete,
  rows,
  unit,
  bagel,
}: {
  athlete: ProgressAthlete;
  rows: LiftProgress[];
  unit: WeightUnit;
  bagel: boolean;
}) {
  const color = ATHLETES[athlete].color;
  const total: LiftTotal = liftTotal(rows, athlete);
  const [press, ...rest] = TOTAL_LIFTS[athlete].map(
    (key) => PROGRESS_LIFTS.find((lift) => lift.key === key)!.name,
  );
  const marks = progressMarks(
    {
      start: asSet(total.start),
      latest: asSet(total.latest),
      best: asSet(total.best),
      target: total.target ?? 0,
    },
    unit,
  );
  const figure = (kg: number | null) => (kg !== null && kg > 0 ? formatWeight(kg, unit) : "—");
  return (
    <div role="group" aria-label={`${ATHLETES[athlete].name} total`} className="space-y-2.5 py-4">
      <div>
        <h3 className="text-sm font-medium">Total</h3>
        <p className="text-[11px] text-muted-foreground">
          {press}, {rest.map((name) => name.toLowerCase()).join(" and ")}
        </p>
      </div>
      <div>
        {marks ? <Bar bar={marks} color={color} unit={unit} leaders runner={athlete} bagel={bagel} /> : null}
        <dl className="grid grid-cols-4">
          <Stat label="Start" value={figure(total.start)} notes={[]} swatch={total.start ? <Swatch /> : null} />
          <Stat
            label="Latest"
            value={figure(total.latest)}
            notes={[]}
            swatch={total.latest ? <Swatch color={color} /> : null}
          />
          <Stat
            label="Best"
            value={figure(total.best)}
            notes={[]}
            swatch={total.best ? <Swatch color={color} /> : null}
          />
          <Stat
            label="Target"
            value={figure(total.target)}
            notes={targetNotes(total.target ?? 0, total.best, unit)}
            swatch={total.target ? <Swatch color={color} ring /> : null}
          />
        </dl>
      </div>
    </div>
  );
}

function Lift({
  athlete,
  lift,
  unit,
  today,
  bagel,
}: {
  athlete: ProgressAthlete;
  lift: LiftProgress;
  unit: WeightUnit;
  today: string;
  bagel: boolean;
}) {
  const color = ATHLETES[athlete].color;
  const label = `${ATHLETES[athlete].name} ${lift.name.toLowerCase()}`;
  const { start, latest, best } = lift;
  const marks = progressMarks(lift, unit);

  // Four dashes say less than one line does.
  if (!start || !latest || !best)
    return (
      <div
        role="group"
        aria-label={label}
        className="space-y-2 py-4 first:pt-0 last:pb-0"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-medium">{lift.name}</h3>
          <p className="text-xs text-muted-foreground">
            Not logged yet ·{" "}
            {lift.target > 0
              ? `target ${formatWeight(lift.target, unit)}${unit === "kg" ? "" : ` · ${formatWeight(lift.target, "kg")}`}`
              : "no target"}
          </p>
        </div>
        {marks ? <Bar bar={marks} color={color} unit={unit} runner={athlete} bagel={bagel} /> : null}
      </div>
    );

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
      <div>
        {marks ? <Bar bar={marks} color={color} unit={unit} leaders runner={athlete} bagel={bagel} /> : null}
        <dl className="grid grid-cols-4">
          <Stat
            label="Start"
            value={formatWeight(start.kg, unit)}
            notes={notes(start)}
            swatch={marks ? <Swatch /> : null}
          />
          <Stat
            label="Latest"
            value={formatWeight(latest.kg, unit)}
            notes={notes(latest)}
            swatch={marks ? <Swatch color={color} /> : null}
          />
          <Stat
            label="Best"
            value={formatWeight(best.kg, unit)}
            notes={notes(best)}
            swatch={marks ? <Swatch color={color} /> : null}
          />
          <Stat
            label="Target"
            value={lift.target > 0 ? formatWeight(lift.target, unit) : "—"}
            notes={targetNotes(lift.target, best.kg, unit)}
            swatch={marks && lift.target > 0 ? <Swatch color={color} ring /> : null}
          />
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">{summary}</p>
      {lift.estimated ? (
        <p className="text-xs text-muted-foreground">
          Estimated max{" "}
          <span className="font-medium text-foreground tabular-nums">
            ~{Math.round(fromKilograms(lift.estimated.kg, unit))} {unit}
          </span>
          , from {formatWeight(lift.estimated.setKg, unit)} × {lift.estimated.reps} on{" "}
          {formatDay(lift.estimated.day, today)}
          {lift.target > 0 ? ` · ${targetPercent(lift.estimated.kg, lift.target)}% of target` : ""}
        </p>
      ) : null}
      <Volume weeks={lift.weeks} unit={unit} color={color} name={label} />
    </div>
  );
}

/**
 * Load times reps a week, the last eight with this one at the end. This week
 * is not over, so its bar can only grow.
 */
function Volume({
  weeks,
  unit,
  color,
  name,
}: {
  weeks: number[];
  unit: WeightUnit;
  color: string;
  name: string;
}) {
  if (!weeks.some((kg) => kg > 0)) return null;
  const shown = weeks.map((kg) => Math.round(fromKilograms(kg, unit)));
  const most = Math.max(...shown);
  const now = shown[shown.length - 1];
  const before = shown[shown.length - 2] ?? 0;
  return (
    <div className="space-y-1.5">
      <div
        role="img"
        aria-label={`${name} weekly volume, oldest first: ${shown.map((value) => `${formatAmount(value)} ${unit}`).join(", ")}`}
        className="flex h-8 items-end gap-1"
      >
        {shown.map((value, index) => (
          <span
            key={index}
            className="flex-1 rounded-sm"
            style={{
              height: `${Math.max(value > 0 ? 8 : 2, (value / most) * 100)}%`,
              background: value > 0 ? color : "var(--muted)",
              opacity: index === shown.length - 1 || value === 0 ? 1 : 0.45,
            }}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Volume, {unit} × reps · this week {formatAmount(now)} · last week {formatAmount(before)} ·{" "}
        {VOLUME_WEEKS} weeks shown
      </p>
    </div>
  );
}

/** The weigh-ins as a trend: where it started, where it is, and how far it has moved. */
function BodyweightTrend({
  athlete,
  history,
  unit,
  today,
}: {
  athlete: ProgressAthlete;
  history: BodyweightHistory;
  unit: WeightUnit;
  today: string;
}) {
  const weighIns = history.weighIns[athlete];
  if (!weighIns.length) return null;
  const first = weighIns[0];
  const last = weighIns[weighIns.length - 1];
  const change = shownGap(first.kg, last.kg, unit);
  return (
    <p className="mb-4 text-xs text-muted-foreground">
      Bodyweight{" "}
      <span className="font-medium text-foreground tabular-nums">{formatWeight(last.kg, unit)}</span>{" "}
      on {formatDay(last.day, today)}
      {weighIns.length > 1
        ? ` · ${change > 0 ? "+" : ""}${change} ${unit} since ${formatDay(first.day, today)} · ${weighIns.length} weigh-ins`
        : ""}
    </p>
  );
}

export function Progress({
  records,
  settings,
  history,
  figures,
  today,
  journalTotal,
  loadingAll = false,
  onLoadAll,
}: {
  /** What the phone holds; benchmarks and the weekly review read these. */
  records: RecordItem[];
  settings: Settings;
  history: BodyweightHistory;
  /** Starts and bests can be anywhere in the journal; these are worked out over all of it. */
  figures: JournalSummary;
  today: string;
  /** Rows in the journal, which can be more than what is loaded. */
  journalTotal: number;
  loadingAll?: boolean;
  /** Set when only the recent slice is loaded, which can hide an older benchmark or week. */
  onLoadAll?: () => void;
}) {
  const [view, setView] = useState<"lifts" | "athx" | "weekly">("lifts");
  const unit = settings.weightUnit ?? "lb";
  // Settings saved before lift targets existed have none stored. Read here,
  // not from the figures, so a target just saved shows before they refresh.
  const targets = settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets;
  const together = figures.togetherLifts;

  return (
    <div className="space-y-4 pb-4">
      <div role="group" aria-label="Progress view" className="flex flex-wrap gap-2">
        {([{ key: "lifts", name: "Main lifts" }, { key: "athx", name: "Benchmarks" }, { key: "weekly", name: "Weekly review" }] as const).map(({ key, name }) => (
          <Button key={key} type="button" size="sm" variant={view === key ? "default" : "outline"} aria-label={key === "athx" ? "ATHX benchmarks" : name} aria-pressed={view === key} onClick={() => setView(key)}>{name}</Button>
        ))}
      </div>
      {view !== "lifts" && records.length < journalTotal && onLoadAll ? (
        <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          <p>Using the latest {formatAmount(records.length)} of {formatAmount(journalTotal)} entries. Older entries could change a benchmark or a weekly comparison.</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={loadingAll} onClick={onLoadAll}>{loadingAll ? "Loading…" : "Include the full journal"}</Button>
        </div>
      ) : null}
      {view === "athx" ? <Benchmarks records={records} today={today} unit={unit} />
        : view === "weekly" ? <WeeklyReview records={records} today={today} unit={unit} /> : <>
      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-muted-foreground" />
          Main lifts
        </h2>
        <p className="text-xs text-muted-foreground">
          Each day counts as its heaviest set, in {unit}. The bar places start,
          latest, best and the target on a scale fitted to them. A target also
          shows in kilograms. The estimated max is what your best set of ten
          reps or fewer predicts for a single, as the race estimate reckons it.
          The total adds press, squat and deadlift. Targets are set in Setup.
        </p>
      </section>

      {PEOPLE.map((athlete) => {
        const rows = figures.lifts[athlete].map((row) => ({
          ...row,
          target: targets[athlete][row.key] ?? 0,
        }));
        const bagel = wearsProteinBagel(records, settings, athlete, today);
        return (
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
            <BodyweightTrend athlete={athlete} history={history} unit={unit} today={today} />
            <div className="divide-y">
              {rows.map((lift) => (
                <Lift key={lift.key} athlete={athlete} lift={lift} unit={unit} today={today} bagel={bagel} />
              ))}
              <Total athlete={athlete} rows={rows} unit={unit} bagel={bagel} />
            </div>
          </section>
        );
      })}

      {together > 0 ? (
        <p className="text-xs text-muted-foreground">
          {together} together session{together === 1 ? "" : "s"} with these lifts{" "}
          {together === 1 ? "is" : "are"} not included. A shared session has no
          single athlete.
        </p>
      ) : null}
      </>}
    </div>
  );
}
