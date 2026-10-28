"use client";

import { formatDay } from "@/lib/client";
import { ATHLETES, METCON, formatDistance, formatTime, type RaceGoals } from "@/lib/domain";
import { FIELD, FIELD_LIFTS, type StrengthPlacing } from "@/lib/field";
import { formatAmount } from "@/lib/fuel";
import {
  ENDURANCE,
  METCON_CAP_SECONDS,
  MIN_PIECE_METRES,
  RACE_ATHLETES,
  RACE_ZONES,
  STRENGTH_2027,
  STRENGTH_LIFTS,
  raceEstimate,
  raceStart,
  zoneProgress,
  zoneScores,
  type EndurancePlan,
  type RaceZone,
  type MetconPlan,
  type RaceAthlete,
  type StrengthLift,
  type StrengthPlan,
} from "@/lib/race";

const who = (athlete: RaceAthlete) => ATHLETES[athlete].name;

/** "Opening row" reads "opening row" mid-sentence; "DB bench press" keeps its capitals. */
const lower = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

const CARRY = METCON.find((station) => station.name === "Sandbag carry")!;

/** "a, b and c", for the lines that say what is still missing. */
function list(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Dot({ athlete }: { athlete: RaceAthlete }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ background: ATHLETES[athlete].color }}
    />
  );
}

function Zone({
  title,
  cap,
  figure,
  unit,
  children,
}: {
  title: string;
  cap: string;
  /** Null shows a dash: nothing logged supports a figure yet. */
  figure: string | null;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={`${title} estimate`} className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">
          {title}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{cap}</span>
        </h3>
        <p className="text-xl font-semibold tabular-nums tracking-tight">
          {figure ?? "—"}
          {figure !== null && unit ? (
            <>
              {" "}
              <span className="text-xs font-normal text-muted-foreground">{unit}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

const kgCell = (kg: number | null | undefined) => (kg === null || kg === undefined ? "—" : formatAmount(kg));

/** Each lift for each of you, and the pair's sum of each. */
function LiftTable({ plan }: { plan: StrengthPlan }) {
  const { athletes, combined } = plan;
  const both = (key: StrengthLift) => {
    const one = athletes.hippos.lifts[key];
    const other = athletes.gators.lifts[key];
    return one && other ? one.shown + other.shown : null;
  };
  return (
    <table className="w-full table-fixed tabular-nums">
      <caption className="sr-only">Estimated lifts in kilograms</caption>
      <thead>
        <tr className="text-[11px]">
          <th scope="col" className="w-[30%] pb-1 text-left font-normal">
            <span className="sr-only">Athlete</span>
          </th>
          {STRENGTH_LIFTS.map((lift) => (
            <th key={lift.key} scope="col" className="pb-1 text-right font-normal">
              {lift.short}
              <span className="block">{STRENGTH_2027.reps[lift.key]}RM</span>
            </th>
          ))}
          <th scope="col" className="pb-1 text-right font-normal">
            Total
            <span className="block">kg</span>
          </th>
        </tr>
      </thead>
      <tbody className="text-foreground">
        {RACE_ATHLETES.map((athlete) => (
          <tr key={athlete}>
            <th scope="row" className="py-0.5 text-left font-normal">
              <span className="flex items-center gap-1.5">
                <Dot athlete={athlete} />
                {who(athlete)}
              </span>
            </th>
            {STRENGTH_LIFTS.map((lift) => (
              <td key={lift.key} className="py-0.5 text-right">
                {kgCell(athletes[athlete].lifts[lift.key]?.shown)}
              </td>
            ))}
            <td className="py-0.5 text-right font-medium">{kgCell(athletes[athlete].total)}</td>
          </tr>
        ))}
        <tr className="border-t">
          <th scope="row" className="pt-1 text-left font-medium">
            Combined
          </th>
          {STRENGTH_LIFTS.map((lift) => (
            <td key={lift.key} className="pt-1 text-right font-medium">
              {kgCell(both(lift.key))}
            </td>
          ))}
          <td className="pt-1 text-right font-semibold">{kgCell(combined)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** 1st, 2nd, 3rd, 4th; 11th, 12th and 13th; 21st. */
function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Where the pair sits in the field: a bar from the bottom to the top, and the figures. */
function Placing({ placing }: { placing: StrengthPlacing }) {
  const field = `${FIELD.season}'s ${formatAmount(placing.pairs)} ${FIELD.label}`;
  if (placing.total === null || placing.percentile === null) {
    // Squats and deadlifts already show under Still to log; only the strict press is new here.
    const press = placing.missing.filter((gap) => gap.lift === "overhead").map((gap) => who(gap.athlete));
    return press.length ? (
      <p>
        A percentile against {field} needs a {FIELD_LIFTS.overhead} for {list(press)}: that season
        allowed no jerks.
      </p>
    ) : null;
  }
  return (
    <div className="pt-1">
      <div aria-hidden="true" className="relative mx-1.5 h-1.5 rounded-full bg-muted">
        {[25, 50, 75].map((at) => (
          <span
            key={at}
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/40"
            style={{ left: `${at}%` }}
          />
        ))}
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
          style={{ left: `${placing.percentile}%`, background: ATHLETES.team.color }}
        />
      </div>
      <p className="mt-2">
        <span className="font-medium text-foreground">{ordinal(placing.percentile)} percentile</span>
        {" · "}ahead of {formatAmount(placing.ahead)} of {field}
      </p>
      <p>
        {formatAmount(placing.total)} kg on that season&apos;s lifts ({FIELD_LIFTS.overhead}, 3RM
        squat, 5RM deadlift) · median {formatAmount(placing.median)} kg
      </p>
    </div>
  );
}

function Strength({ plan, placing }: { plan: StrengthPlan; placing: StrengthPlacing }) {
  const { athletes, combined } = plan;
  const hippos = athletes.hippos.total;
  // Whole percents that add up to a hundred, so the two read as one split.
  const share = combined && hippos !== null ? Math.round((hippos / combined) * 100) : null;
  const overhead = RACE_ATHLETES.flatMap((athlete) => {
    const lift = athletes[athlete].lifts.overhead;
    // Both names end in s.
    return lift ? [`${who(athlete)}' ${lower(lift.name)}`] : [];
  });
  const missing = RACE_ATHLETES.flatMap((athlete) => {
    const lifts = STRENGTH_LIFTS.filter((lift) => !athletes[athlete].lifts[lift.key]);
    return lifts.length
      ? [`${who(athlete)} ${list(lifts.map((lift) => lower(lift.name)))}`]
      : [];
  });

  return (
    <Zone
      title="Strength"
      cap="20 min"
      figure={combined === null ? null : formatAmount(combined)}
      unit="kg"
    >
      {share !== null ? (
        <div>
          <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full" style={{ width: `${share}%`, background: ATHLETES.hippos.color }} />
            <div className="h-full" style={{ width: `${100 - share}%`, background: ATHLETES.gators.color }} />
          </div>
          <p className="mt-1 flex justify-between tabular-nums">
            <span>
              {who("hippos")} {share}%
            </span>
            <span>
              {who("gators")} {100 - share}%
            </span>
          </p>
        </div>
      ) : null}
      {/* A table of dashes says less than the line underneath it. */}
      {RACE_ATHLETES.some((athlete) => STRENGTH_LIFTS.some((lift) => athletes[athlete].lifts[lift.key])) ? (
        <LiftTable plan={plan} />
      ) : null}
      {overhead.length ? <p>S2OH counts {list(overhead)}.</p> : null}
      <Placing placing={placing} />
      {missing.length ? <p>Still to log: {missing.join("; ")}.</p> : null}
    </Zone>
  );
}

function Endurance({ plan }: { plan: EndurancePlan }) {
  const { run, ski } = plan;
  const runs = RACE_ATHLETES.map((athlete) => {
    const seconds = run[athlete];
    return `${who(athlete)} ${seconds === null ? "—" : formatTime(seconds)}`;
  });
  const whose = (piece: "run" | "ski") =>
    list(plan.missing.filter((gap) => gap.piece === piece).map((gap) => who(gap.athlete)));
  const missing = [
    whose("run") ? `a run for ${whose("run")}` : "",
    whose("ski") ? `a SkiErg piece for ${whose("ski")}` : "",
  ].filter(Boolean);

  return (
    <Zone
      title="Endurance"
      cap="24 min cap"
      figure={plan.metres === null ? null : formatAmount(plan.metres)}
      unit="m SkiErg"
    >
      {run.hippos !== null || run.gators !== null ? (
        <p>
          Run {formatDistance(ENDURANCE.runMetres / 1000, "km")} · {runs.join(" · ")}
        </p>
      ) : null}
      {ski ? (
        plan.skiFrom === null ? (
          <p>No time left to ski before the cap.</p>
        ) : (
          <p>
            SkiErg from {formatTime(plan.skiFrom)}
            {RACE_ATHLETES.map((athlete) => {
              const { seconds, metres } = ski[athlete];
              // Non-breaking, so a figure never wraps away from its unit.
              return ` · ${who(athlete)} ${metres === null ? "—" : `${formatAmount(metres)}\u00a0m`} in\u00a0${formatTime(seconds)}`;
            }).join("")}
          </p>
        )
      ) : null}
      {missing.length ? (
        <p>
          Still to log: {missing.join("; ")}, each{" "}
          {formatDistance(MIN_PIECE_METRES / 1000, "km")} or longer.
        </p>
      ) : null}
    </Zone>
  );
}

/** Who the plan gives the shared stations to: the one with fewer is named. */
function takes(plan: MetconPlan) {
  const by = (athlete: RaceAthlete) =>
    plan.stations.filter((station) => station.by === athlete).map((station) => lower(station.name));
  const [few, many] = by("hippos").length <= by("gators").length
    ? (["hippos", "gators"] as const)
    : (["gators", "hippos"] as const);
  const each = `${formatAmount(CARRY.target / 2)}\u00a0m each`;
  const carry = `the carry is ${each}`;
  if (by(many).length === 0) return `Either of you can take each station; ${carry}.`;
  if (by(few).length === 0) return `${who(many)} takes every station but the carry, which is ${each}.`;
  return `${who(few)} takes ${list(by(few))}, ${who(many)} the rest; ${carry}.`;
}

function Metcon({ plan }: { plan: MetconPlan }) {
  const untimed = plan.missing.map(({ station, athlete }) =>
    athlete ? `${who(athlete)}' ${lower(station)}` : lower(station),
  );
  return (
    <Zone
      title="MetCon X"
      cap="25 min cap"
      figure={plan.seconds === null ? null : formatTime(plan.seconds)}
    >
      {plan.seconds === null ? (
        plan.stations.every((station) => station.by === null) ? (
          <p>Log the circuit with a split at each station to estimate it.</p>
        ) : (
          <p>Still to time: {list(untimed)}.</p>
        )
      ) : (
        <>
          {plan.seconds > METCON_CAP_SECONDS ? (
            <p>Over the {formatTime(METCON_CAP_SECONDS)} cap.</p>
          ) : null}
          <p>{takes(plan)}</p>
          <p>
            {plan.changeoversKnown
              ? `Includes ${formatTime(plan.changeovers)} moving between stations.`
              : "Stations only. A circuit logged with its elapsed time adds the moves between them."}
          </p>
        </>
      )}
    </Zone>
  );
}

const SCORE: Record<RaceZone, (score: number) => string> = {
  strength: (kg) => `${formatAmount(kg)}\u00a0kg`,
  endurance: (metres) => `${formatAmount(metres)}\u00a0m`,
  metcon: (seconds) => formatTime(seconds),
};

/**
 * Each zone from its first estimate to the goal set in Setup, with where the
 * pair is now. The bar is the share of that distance covered, so falling back
 * below the start reads as nothing covered rather than running off the end.
 */
export function RaceProgress({
  estimate,
  start,
  goals,
  today,
}: {
  estimate: ReturnType<typeof raceEstimate>;
  /** Missing from a summary worked out before starts were. */
  start: ReturnType<typeof raceStart> | undefined;
  goals: RaceGoals | undefined;
  today: string;
}) {
  const current = zoneScores(estimate);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Progress
        </h2>
        <p className="text-[11px] text-muted-foreground">Start · now · goal</p>
      </div>
      <div className="space-y-3.5">
        {RACE_ZONES.map(({ key, name, lower }) => {
          const now = current[key];
          const from = start?.[key] ?? null;
          const goal = goals?.[key] ?? 0;
          const pct = from && now !== null ? zoneProgress(from.score, now, goal, lower) : null;
          const reached = goal > 0 && now !== null && (lower ? now <= goal : now >= goal);
          return (
            <div key={key} role="group" aria-label={`${name} progress`}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">{name}</h3>
                <p className="text-sm font-semibold tabular-nums">
                  {now === null ? "—" : SCORE[key](now)}
                  {pct !== null && !reached ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {Math.round(pct)}%
                    </span>
                  ) : null}
                </p>
              </div>
              <div
                aria-hidden="true"
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${reached ? 100 : pct ?? 0}%`, background: ATHLETES.team.color }}
                />
              </div>
              <p className="mt-1 flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
                <span>
                  {from ? `Start ${SCORE[key](from.score)} · ${formatDay(from.day, today)}` : "No estimate yet"}
                </span>
                <span>
                  {goal > 0 ? `${reached ? "Reached" : "Goal"} ${SCORE[key](goal)}` : "No goal in Setup"}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the pair would score if the race were today. Every figure is worked
 * out from the whole journal as it stands, so logging a session moves it:
 * by the server while the phone holds only the recent slice.
 */
export function RaceEstimate({
  estimate,
  placing,
}: {
  estimate: ReturnType<typeof raceEstimate>;
  placing: StrengthPlacing;
}) {
  return (
    <div className="mt-5 border-t pt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Race-day estimate
        </h2>
        <p className="text-[11px] text-muted-foreground">Lite pairs · from your log</p>
      </div>
      <div className="divide-y">
        <Strength plan={estimate.strength} placing={placing} />
        <Endurance plan={estimate.endurance} />
        <Metcon plan={estimate.metcon} />
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium">How these are worked out</summary>
        <div className="mt-2 space-y-2">
          <p>
            Strength is the 2027 pairs score: each of you lifts a 1RM shoulder to overhead, a
            2RM back squat and a 3RM deadlift, and all six are added. Each is the most your
            logged sets of up to ten reps predict on Brzycki&apos;s rep-max line. Presses,
            push presses, jerks and clean and jerks all count overhead.
          </p>
          <p>
            Endurance: each of you runs 2.4 km, the first back starts on your SkiErg, and you
            take turns once you are both there, until 24:00. Times and distances follow
            Riegel&apos;s curve from your best run and SkiErg piece of a kilometre or more.
          </p>
          <p>
            MetCon X gives each station to whichever of you has timed it quicker, at that
            pace, with the carry 30 m each. Taking turns well should only beat it. Time
            between stations comes from circuits logged with an elapsed time.
          </p>
          <p>
            The percentile places your Strength among {FIELD.season}&apos;s mixed Lite pairs on
            the ATHX leaderboard. That season scored a strict press for one, a squat for three
            and a deadlift for five, so your lifts are carried to those reps the same way; a
            2027 total set against it would flatter you. Endurance and MetCon X changed format
            for 2027, so they wait for 2027 results.
          </p>
        </div>
      </details>
    </div>
  );
}
