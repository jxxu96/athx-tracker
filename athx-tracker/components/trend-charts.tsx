"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { weeklyAverage } from "@/lib/bodyweight";
import { dayToDate } from "@/lib/client";
import { ATHLETES, fromKilograms, type Bodyweight, type WeightUnit } from "@/lib/domain";
import type { ProteinWeek } from "@/lib/protein-week";

/**
 * Three small trends for Progress, one athlete each: bodyweight with its
 * seven-day average, a lift's figure week by week, and protein against the
 * target week by week. One athlete to a chart, so a colour never has to tell
 * the two of you apart; the card they sit in says whose they are. The marks
 * use the athlete's ink colour, the version that holds 3:1 against the card
 * in both themes. Every value is also in the table under each chart.
 */

type Athlete = "hippos" | "gators";

const SURFACE = "var(--card)";
const MUTED = "var(--muted-foreground)";

const timeOf = (day: string) => dayToDate(day).getTime();
const shortDate = (time: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(time));
const tenth = (value: number) => Math.round(value * 10) / 10;
const shown = (kg: number, unit: WeightUnit) => tenth(fromKilograms(kg, unit));

/**
 * Round ticks, three or four, that take in every value, and a target outside them: a
 * step of 1, 2, 2.5 or 5 times a power of ten, so the axis reads 120 / 180 /
 * 240 rather than 119 / 179 / 232. The domain is the first and last tick.
 */
function niceAxis(values: number[]) {
  let low = Math.min(...values);
  let high = Math.max(...values);
  // A flat line still gets an axis a couple of units tall, and every line a little air.
  if (high - low < 2) {
    const middle = (low + high) / 2;
    low = middle - 1;
    high = middle + 1;
  }
  const air = (high - low) * 0.08;
  low -= air;
  high += air;
  const power = 10 ** Math.floor(Math.log10((high - low) / 3));
  for (const multiple of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
    const step = multiple * power;
    const start = Math.floor(low / step) * step;
    const count = Math.ceil((high - start) / step - 1e-9) + 1;
    if (count > 4) continue;
    const ticks = Array.from({ length: Math.max(2, count) }, (_, index) => Math.round((start + index * step) * 100) / 100);
    return { domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], ticks };
  }
  return { domain: [Math.floor(low), Math.ceil(high)] as [number, number], ticks: undefined };
}

/** The first and last day, and one between when the span is long enough to need it. */
function dayTicks(times: number[]) {
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (last - first < 21 * 86_400_000) return first === last ? [first] : [first, last];
  return [first, Math.round((first + last) / 2), last];
}

/** The hover card: the value first and strong, what it is after it, keyed by a short stroke. */
function Readout({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="grid min-w-32 gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg">
      <p className="text-[11px] text-muted-foreground">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-1.5">
          {row.color ? (
            <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
          ) : null}
          <span className="font-semibold tabular-nums">{row.value}</span>
          <span className="text-muted-foreground">{row.label}</span>
        </p>
      ))}
    </div>
  );
}

/** The values behind a chart, for reading without hovering or without sight. */
function Values({ summary, head, rows }: { summary: string; head: string[]; rows: string[][] }) {
  return (
    <details className="text-[11px] text-muted-foreground">
      <summary className="w-fit cursor-pointer py-1 hover:text-foreground">{summary}</summary>
      <div className="mt-1 max-h-48 overflow-y-auto">
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={cell} scope="col" className="py-0.5 pr-3 font-medium">{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="text-foreground">
                {row.map((cell, column) => (
                  <td key={column} className="py-0.5 pr-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A key entry that mirrors its mark: a dot for the weigh-ins, a stroke for the average. */
function Key({ mark, color, label }: { mark: "dot" | "line"; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={mark === "dot" ? "size-2 rounded-full opacity-50" : "h-0.5 w-3 rounded-full"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

const axisTick = { fontSize: 10 };

/**
 * Every weigh-in as a faint dot and the seven-day average as the line. A
 * day's weight moves with water and food by more than a week of training
 * does, so the line is the trend to read.
 */
export function BodyweightChart({
  athlete,
  weighIns,
  unit,
}: {
  athlete: Athlete;
  weighIns: readonly Bodyweight[];
  unit: WeightUnit;
}) {
  if (weighIns.length < 2) return null;
  const color = ATHLETES[athlete].ink;
  const data = weeklyAverage(weighIns).map((point) => ({
    time: timeOf(point.day),
    weight: shown(point.kg, unit),
    average: shown(point.average, unit),
  }));
  const times = data.map((point) => point.time);
  return (
    <div className="space-y-1.5">
      <ChartContainer config={{}} className="aspect-auto h-32 w-full">
        <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={dayTicks(times)}
            tickFormatter={shortDate}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
          />
          <YAxis
            {...niceAxis(data.flatMap((point) => [point.weight, point.average]))}
            tickLine={false}
            axisLine={false}
            width={34}
            tick={axisTick}
          />
          <Tooltip
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return point ? (
                <Readout
                  title={shortDate(point.time)}
                  rows={[
                    { label: "weigh-in", value: `${point.weight} ${unit}` },
                    { label: "7-day average", value: `${point.average} ${unit}`, color },
                  ]}
                />
              ) : null;
            }}
          />
          <Line
            dataKey="weight"
            stroke="none"
            isAnimationActive={false}
            dot={{ r: 4, fill: color, fillOpacity: 0.45, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={false}
          />
          <Line
            dataKey="average"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex gap-3">
          <Key mark="dot" color={color} label="Weigh-in" />
          <Key mark="line" color={color} label="7-day average" />
        </span>
        <Values
          summary="Values"
          head={["Day", `Weigh-in (${unit})`, `7-day average (${unit})`]}
          rows={[...data].reverse().map((point) => [shortDate(point.time), String(point.weight), String(point.average)])}
        />
      </div>
    </div>
  );
}

/**
 * A lift's figure at its rep max, the best of each week, with the target as
 * a level line when there is one. The axis takes the target in, so how far is
 * left reads off the chart.
 */
export function LiftChart({
  athlete,
  name,
  reps,
  history,
  target,
  unit,
}: {
  athlete: Athlete;
  name: string;
  reps: number;
  history: readonly { day: string; kg: number }[];
  /** Kilograms. Zero is no target. */
  target: number;
  unit: WeightUnit;
}) {
  if (history.length < 2) return null;
  const color = ATHLETES[athlete].ink;
  const data = history.map((point) => ({ time: timeOf(point.day), value: shown(point.kg, unit) }));
  const goal = target > 0 ? shown(target, unit) : null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">Best {reps}RM each week</p>
      <ChartContainer config={{}} className="aspect-auto h-28 w-full">
        <LineChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={dayTicks(data.map((point) => point.time))}
            tickFormatter={shortDate}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
          />
          <YAxis
            {...niceAxis([...data.map((point) => point.value), ...(goal === null ? [] : [goal])])}
            tickLine={false}
            axisLine={false}
            width={34}
            tick={axisTick}
          />
          {goal !== null ? (
            <ReferenceLine
              y={goal}
              stroke={MUTED}
              strokeOpacity={0.7}
              strokeWidth={1}
              label={{ value: `Target ${goal} ${unit}`, position: "insideTopLeft", fill: MUTED, fontSize: 10 }}
            />
          ) : null}
          <Tooltip
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return point ? (
                <Readout
                  title={shortDate(point.time)}
                  rows={[{ label: `${name} ${reps}RM`, value: `${point.value} ${unit}`, color }]}
                />
              ) : null;
            }}
          />
          <Line
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            isAnimationActive={false}
            dot={{ r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: color, stroke: SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ChartContainer>
      <Values
        summary="Values"
        head={["Week's best on", `${reps}RM (${unit})`]}
        rows={[...data].reverse().map((point) => [shortDate(point.time), String(point.value)])}
      />
    </div>
  );
}

/**
 * Protein as a share of the target, a Monday week at a time, counted as the
 * bagel counts it: days with a known meal, each against its own target. The
 * week still under way is drawn lighter, since it can only change.
 */
export function ProteinChart({ athlete, weeks }: { athlete: Athlete; weeks: readonly ProteinWeek[] }) {
  const color = ATHLETES[athlete].ink;
  const data = weeks.map((week, index) => ({
    label: shortDate(timeOf(week.start)),
    value: week.target > 0 && week.days > 0 ? Math.round((week.eaten / week.target) * 100) : null,
    days: week.days,
    current: index === weeks.length - 1,
  }));
  const measured = data.filter((week) => week.value !== null);
  if (measured.length === 0) return null;
  const top = Math.max(110, ...measured.map((week) => (week.value ?? 0) + 10));
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">
        Protein, % of target by week · days with a meal · under 90% earns the bagel
      </p>
      <ChartContainer config={{}} className="aspect-auto h-28 w-full">
        <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" interval="preserveStartEnd" tickLine={false} axisLine={false} tick={axisTick} />
          <YAxis
            domain={[0, Math.ceil(top / 10) * 10]}
            ticks={[0, 50, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tickLine={false}
            axisLine={false}
            width={34}
            tick={axisTick}
          />
          <ReferenceLine y={100} stroke={MUTED} strokeOpacity={0.7} strokeWidth={1} />
          <Tooltip
            cursor={{ fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              const week = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return week ? (
                <Readout
                  title={`Week of ${week.label}${week.current ? " · so far" : ""}`}
                  rows={[
                    {
                      label: "of target",
                      value: week.value === null ? "—" : `${week.value}%`,
                      color,
                    },
                    { label: week.days === 1 ? "day logged" : "days logged", value: String(week.days) },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            {data.map((week) => (
              <Cell key={week.label} fillOpacity={week.current ? 0.5 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <Values
        summary="Values"
        head={["Week of", "Of target", "Days logged"]}
        rows={[...data].reverse().map((week) => [
          `${week.label}${week.current ? " (so far)" : ""}`,
          week.value === null ? "—" : `${week.value}%`,
          String(week.days),
        ])}
      />
    </div>
  );
}
