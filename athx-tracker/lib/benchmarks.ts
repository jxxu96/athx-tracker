import { METCON, isDistanceUnit, segmentBlock, toMetres, type Athlete, type RecordItem, type Segment, type Workout } from "./domain.ts";
import { matchMovement } from "./movement-match.ts";

export type BenchmarkWork = { name: string; target: number; completed: number; unit: string; kg: number | null };
export type BenchmarkAttempt = { id: string; day: string; seconds: number; work: number };
export type BenchmarkSeries = {
  key: string;
  name: string;
  kind: "circuit" | "station";
  context: Workout["context"];
  status: "complete" | "capped" | "partial";
  work: BenchmarkWork[];
  /** Newest first. Capped/unfinished circuits compare only the same elapsed time. */
  attempts: BenchmarkAttempt[];
};

const names = new Map<string, string>();
function stationName(raw: string) {
  let name = names.get(raw);
  if (name === undefined) {
    const match = matchMovement(raw);
    name = match.listed ? match.name : raw.trim();
    names.set(raw, name);
  }
  return name;
}

const rounded = (n: number) => Math.round(n * 10000) / 10000;
function workOf(segment: Segment): BenchmarkWork {
  const volume = (value: number) => isDistanceUnit(segment.unit) ? toMetres(value, segment.unit) : value;
  return {
    name: stationName(segment.name),
    target: rounded(volume(segment.target)),
    completed: rounded(volume(segment.completed)),
    unit: isDistanceUnit(segment.unit) ? "m" : segment.unit,
    // Preserve unknown loads as unknown, and match the stored hundredth of a kg.
    kg: segment.kg === undefined ? null : Math.round(segment.kg * 100) / 100,
  };
}

/** Actual observations only: no predicted finishes or pace borrowed from another station. */
export function benchmarkSeries(records: RecordItem[], athlete: Athlete, through: string): BenchmarkSeries[] {
  const groups = new Map<string, BenchmarkSeries>();
  const add = (workout: Workout, kind: BenchmarkSeries["kind"], work: BenchmarkWork[], seconds: number, status: BenchmarkSeries["status"]) => {
    if (!(seconds > 0)) return;
    const key = JSON.stringify([
      kind, workout.context, status, kind === "station" || status === "complete" ? null : seconds,
      work.map((item) => [item.name, item.target, item.unit, item.kg, kind === "station" ? item.completed : null]),
    ]);
    const group = groups.get(key) ?? {
      key, name: kind === "circuit" ? "ATHX circuit" : work[0].name,
      kind, context: workout.context, status, work, attempts: [],
    };
    group.attempts.push({
      id: workout.id, day: workout.day, seconds,
      work: work.reduce((sum, item) => sum + Math.min(1, item.completed / item.target), 0) / work.length,
    });
    groups.set(key, group);
  };

  for (const record of records) {
    if (record.kind !== "workout" || record.athlete !== athlete || record.day > through) continue;
    for (const segment of record.segments) {
      if (segmentBlock(record, segment) !== "metcon" || !(segment.completed > 0) || !(segment.target > 0)) continue;
      const work = workOf(segment);
      if (!METCON.some((station) => station.name === work.name)) continue;
      add(record, "station", [work], segment.seconds, segment.completed >= segment.target ? "complete" : "partial");
    }
    // Mixed-session clocks also contain lifts/runs. Only a dedicated circuit's
    // clock can be compared as a full circuit; its stations must be in race order.
    if (record.category !== "MetCon" || record.lifts.length || record.segments.length !== METCON.length) continue;
    const work = record.segments.map(workOf);
    if (!work.every((item, index) => item.name === METCON[index].name && item.target > 0
      && segmentBlock(record, record.segments[index]) === "metcon")) continue;
    if (record.segments.reduce((sum, segment) => sum + segment.seconds, 0) > record.seconds + 1) continue;
    const complete = work.every((item) => item.completed >= item.target);
    add(record, "circuit", work, record.seconds, record.capHit ? "capped" : complete ? "complete" : "partial");
  }
  return [...groups.values()].map((group) => ({
    ...group, attempts: group.attempts.sort((a, b) => b.day.localeCompare(a.day)),
  })).sort((a, b) => b.attempts[0].day.localeCompare(a.attempts[0].day));
}

export function bestAttempt(series: BenchmarkSeries, attempts = series.attempts) {
  const byTime = series.kind === "station" || series.status === "complete";
  return attempts.reduce<BenchmarkAttempt | null>((best, attempt) => {
    if (!best) return attempt;
    const better = byTime ? attempt.seconds < best.seconds : attempt.work > best.work;
    // Credit the first day a best was reached.
    const tied = byTime ? attempt.seconds === best.seconds : attempt.work === best.work;
    return better || (tied && attempt.day < best.day) ? attempt : best;
  }, null);
}

/** New bests this week, against earlier attempts with identical work, load and context. */
export function benchmarkImprovements(records: RecordItem[], athlete: Athlete, start: string, end: string) {
  return benchmarkSeries(records, athlete, end).flatMap((series) => {
    if (series.status !== "complete") return [];
    const before = bestAttempt(series, series.attempts.filter((attempt) => attempt.day < start));
    const current = bestAttempt(series, series.attempts.filter((attempt) => attempt.day >= start));
    return before && current && current.seconds < before.seconds
      ? [{ series, before, current, saved: before.seconds - current.seconds }]
      : [];
  }).sort((a, b) => b.saved - a.saved);
}
