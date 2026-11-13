"use client";

import { useState } from "react";
import { Benchmarks } from "@/components/benchmarks";
import { Creature, RUNNER_BOX, RUNNER_GAP } from "@/components/creatures";
import { WeeklyReview } from "@/components/weekly-review";
import { BodyweightChart, LiftChart, ProteinChart } from "@/components/lazy-charts";
import { Button } from "@/components/ui/button";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  formatWeight,
  fromKilograms,
  type LiftTargets,
  type RecordItem,
  type Settings,
  type WeightUnit,
} from "@/lib/domain";
import { weeklyAverage, type BodyweightHistory } from "@/lib/bodyweight";
import { formatDay } from "@/lib/client";
import { formatAmount, targetPercent } from "@/lib/fuel";
import { wearsProteinBagel } from "@/lib/protein-week";
import { STRENGTH_2027, STRENGTH_LIFTS } from "@/lib/race";
import type { JournalSummary } from "@/lib/summary";
import {
  liftTotal,
  progressMarks,
  shownGap,
  toGo,
  type EstimatedMax,
  type LiftProgress,
  type LiftTotal,
  leaderLanes,
  type ProgressAthlete,
  type ProgressBar,
  type ProgressMark,
  type StrengthProgress,
} from "@/lib/progress";

const PEOPLE = ["hippos", "gators"] as const;

/**
 * Start stays a light grey dot. Latest is an empty ring in the athlete's
 * colour, best is that ring with diagonal stripes, and the target is solid.
 * These stay at full strength: a faded athlete colour vanished on dark.
 */
const START_FILL = { background: "var(--muted-foreground)", opacity: 0.5 };

const MARK_BOX: Record<ProgressMark, string> = {
  start: "size-2.5",
  latest: "size-4",
  best: "size-4",
  target: "size-4",
};

/** A few colour stripes across a clear circle, clipped inside the outline. */
function hatch(color: string) {
  return `repeating-linear-gradient(-45deg, ${color} 0 1.75px, transparent 1.75px 4.5px)`;
}

function MarkFace({
  kind,
  color,
  onBar = false,
}: {
  kind: ProgressMark;
  color?: string;
  /** The scale's mark. The legend uses the same face without this. */
  onBar?: boolean;
}) {
  const box = `block shrink-0 rounded-full ${MARK_BOX[kind]}`;
  if (kind === "start") {
    return (
      <span aria-hidden="true" data-progress-mark={onBar ? kind : undefined} className={box} style={START_FILL} />
    );
  }
  if (kind === "latest") {
    return (
      <span
        aria-hidden="true"
        data-progress-mark={onBar ? kind : undefined}
        className={`${box} border-2 bg-card`}
        style={{ borderColor: color }}
      />
    );
  }
  if (kind === "best") {
    return (
      <span
        aria-hidden="true"
        data-progress-mark={onBar ? kind : undefined}
        className={`${box} border-2 bg-card bg-clip-padding`}
        style={{ borderColor: color, backgroundImage: hatch(color ?? "transparent") }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-progress-mark={onBar ? kind : undefined}
      className={box}
      style={{ background: color }}
    />
  );
}

function Swatch({ kind, color }: { kind: ProgressMark; color?: string }) {
  return <MarkFace kind={kind} color={color} />;
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
  return (
    <span
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${at}%`, zIndex: MARK_LAYER[kind] }}
    >
      <MarkFace kind={kind} color={color} onBar />
    </span>
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
/** A column's swatch, centred on each quarter of the row. */
const atColumn = (column: number) => `calc(25% * ${column} + 8px)`;

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
  // The creature stands on the line. The gap above it keeps the bagel off the clip.
  const origin = runner ? RUNNER_BOX + RUNNER_GAP : LINE_Y;
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
            style={{ top: origin - RUNNER_BOX - RUNNER_GAP, height: RUNNER_BOX + RUNNER_GAP }}
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

/** What is left to the target, in the screen unit alone. */
function targetNotes(targetKg: number, bestKg: number | null, unit: WeightUnit) {
  const notes: string[] = [];
  if (!(targetKg > 0)) {
    notes.push("Set in Setup");
    return notes;
  }
  if (bestKg === null) return notes;
  const gap = toGo({ best: { kg: bestKg }, target: targetKg }, unit);
  if (gap === null) return notes;
  if (gap <= 0) {
    notes.push("Reached");
    return notes;
  }
  notes.push(`${gap} ${unit} to go`);
  return notes;
}

function asSet(kg: number | null) {
  return kg !== null && kg > 0 ? { kg } : null;
}

/** "Shoulder to overhead 1RM, back squat 2RM and deadlift 3RM". */
const [OVERHEAD, ...BELOW] = STRENGTH_LIFTS.map(
  ({ key, name }, index) => `${index ? name.toLowerCase() : name} ${STRENGTH_2027.reps[key]}RM`,
);
const TOTAL_OF = `${OVERHEAD}, ${BELOW.join(" and ")}`;

function Total({
  athlete,
  windows,
  targets,
  unit,
  bagel,
}: {
  athlete: ProgressAthlete;
  windows: StrengthProgress;
  targets: LiftTargets;
  unit: WeightUnit;
  bagel: boolean;
}) {
  const color = ATHLETES[athlete].color;
  const total: LiftTotal = liftTotal(windows, targets, athlete);
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
          {TOTAL_OF} · any press or jerk counts overhead
        </p>
      </div>
      <div>
        {marks ? <Bar bar={marks} color={color} unit={unit} leaders runner={athlete} bagel={bagel} /> : null}
        <dl className="grid grid-cols-4">
          <Stat label="Start" value={figure(total.start)} notes={[]} swatch={total.start ? <Swatch kind="start" /> : null} />
          <Stat
            label="Latest"
            value={figure(total.latest)}
            notes={[]}
            swatch={total.latest ? <Swatch kind="latest" color={color} /> : null}
          />
          <Stat
            label="Best"
            value={figure(total.best)}
            notes={[]}
            swatch={total.best ? <Swatch kind="best" color={color} /> : null}
          />
          <Stat
            label="Target"
            value={figure(total.target)}
            notes={targetNotes(total.target ?? 0, total.best, unit)}
            swatch={total.target ? <Swatch kind="target" color={color} /> : null}
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
  const heading = (
    <h3 className="text-lg font-medium">
      {lift.name} <span className="font-normal text-muted-foreground">· {lift.reps}RM</span>
    </h3>
  );

  // Four dashes say less than one line does.
  if (!start || !latest || !best)
    return (
      <div
        role="group"
        aria-label={label}
        className="space-y-2 py-4 first:pt-0 last:pb-0"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {heading}
          <p className="text-xs text-muted-foreground">
            Not logged yet ·{" "}
            {lift.target > 0
              ? `target ${formatWeight(lift.target, unit)}`
              : "no target"}
          </p>
        </div>
        {marks ? <Bar bar={marks} color={color} unit={unit} runner={athlete} bagel={bagel} /> : null}
      </div>
    );

  const share = targetPercent(best.kg, lift.target);
  const gained = shownGap(start.kg, best.kg, unit);
  // The set each figure comes from, so a carried-down single shows what it rests on.
  const notes = (set: EstimatedMax) => [formatDay(set.day, today), `${formatWeight(set.setKg, unit)} × ${set.reps}`];
  const summary = [
    gained > 0 ? `+${gained} ${unit} since start` : "",
    share !== null ? `${share}% of target` : "",
    `${lift.sessions} session${lift.sessions === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div role="group" aria-label={label} className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      {heading}
      <div>
        {marks ? <Bar bar={marks} color={color} unit={unit} leaders runner={athlete} bagel={bagel} /> : null}
        <dl className="grid grid-cols-4">
          <Stat
            label="Start"
            value={formatWeight(start.kg, unit)}
            notes={notes(start)}
            swatch={marks ? <Swatch kind="start" /> : null}
          />
          <Stat
            label="Latest"
            value={formatWeight(latest.kg, unit)}
            notes={notes(latest)}
            swatch={marks ? <Swatch kind="latest" color={color} /> : null}
          />
          <Stat
            label="Best"
            value={formatWeight(best.kg, unit)}
            notes={notes(best)}
            swatch={marks ? <Swatch kind="best" color={color} /> : null}
          />
          <Stat
            label="Target"
            value={lift.target > 0 ? formatWeight(lift.target, unit) : "—"}
            notes={targetNotes(lift.target, best.kg, unit)}
            swatch={marks && lift.target > 0 ? <Swatch kind="target" color={color} /> : null}
          />
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">{summary}</p>
      <LiftChart
        athlete={athlete}
        name={lift.name}
        reps={lift.reps}
        history={lift.history ?? []}
        target={lift.target}
        unit={unit}
      />
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
  return (
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
  );
}

/**
 * The weigh-ins as a trend: where it started, where it is, how far it has
 * moved, and the chart of them with their seven-day average.
 */
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
  const average = weeklyAverage(weighIns).at(-1)?.average ?? last.kg;
  return (
    <div className="mb-4 space-y-2">
      <p className="text-xs text-muted-foreground">
        Bodyweight{" "}
        <span className="font-medium text-foreground tabular-nums">{formatWeight(last.kg, unit)}</span>{" "}
        on {formatDay(last.day, today)}
        {weighIns.length > 1
          ? ` · 7-day average ${formatWeight(average, unit)} · ${change > 0 ? "+" : ""}${change} ${unit} since ${formatDay(first.day, today)} · ${weighIns.length} weigh-ins`
          : ""}
      </p>
      <BodyweightChart athlete={athlete} weighIns={weighIns} unit={unit} />
    </div>
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
            {figures.protein ? (
              <div className="mb-4">
                <ProteinChart athlete={athlete} weeks={figures.protein[athlete]} />
              </div>
            ) : null}
            <div className="divide-y">
              {rows.map((lift) => (
                <Lift key={lift.key} athlete={athlete} lift={lift} unit={unit} today={today} bagel={bagel} />
              ))}
              <Total
                athlete={athlete}
                windows={figures.strength[athlete]}
                targets={targets[athlete]}
                unit={unit}
                bagel={bagel}
              />
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
