"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ATHLETES, METCON, formatTime, formatWeight, type Athlete, type RecordItem, type WeightUnit } from "@/lib/domain";
import { formatDay } from "@/lib/client";
import { formatAmount } from "@/lib/fuel";
import { benchmarkSeries, bestAttempt, type BenchmarkAttempt, type BenchmarkSeries } from "@/lib/benchmarks";

const percent = (attempt: BenchmarkAttempt) => `${Math.round(attempt.work * 100)}% of the work`;
const statusName = { complete: "Completed", capped: "Time cap", partial: "Unfinished" };

function AttemptCard({ series, unit, today }: { series: BenchmarkSeries; unit: WeightUnit; today: string }) {
  const [shown, setShown] = useState(5);
  const latest = series.attempts[0];
  const previous = series.attempts[1];
  const best = bestAttempt(series)!;
  const byTime = series.kind === "station" || series.status === "complete";
  const loads = series.work.filter((work) => work.kg !== null);
  const workLabel = series.kind === "station"
    ? `${formatAmount(series.work[0].completed)}/${formatAmount(series.work[0].target)} ${series.work[0].unit} · ${series.work[0].kg === null ? "load not recorded" : formatWeight(series.work[0].kg, unit)}`
    : loads.length ? loads.map((work) => `${work.name} ${formatWeight(work.kg!, unit)}`).join(" · ") : "Loads not recorded";
  const value = (attempt: BenchmarkAttempt) => byTime ? formatTime(attempt.seconds) : percent(attempt);
  let change = "Log another matching attempt to compare.";
  if (previous) {
    const delta = byTime ? latest.seconds - previous.seconds : Math.round((latest.work - previous.work) * 100);
    change = delta === 0 ? "Matched the previous attempt."
      : byTime ? `${formatTime(Math.abs(delta))} ${delta < 0 ? "faster" : "slower"} than the previous attempt.`
        : `${Math.abs(delta)} percentage point${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "more" : "less"} work than the previous attempt.`;
  }
  return (
    <section aria-label={`${series.name} · ${series.context} · ${statusName[series.status]}`} className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{series.name}</h3>
        <p className="text-xs text-muted-foreground">{series.context === "pairs" ? "Pairs" : "Solo"} · {statusName[series.status]}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{workLabel}</p>
      {!byTime ? <p className="mt-1 text-xs text-muted-foreground">Work completed in {formatTime(latest.seconds)}. Only attempts with this same elapsed time are compared. Work percentage averages each station’s completed share.</p> : null}
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {[{ label: "Best", attempt: best }, { label: "Latest", attempt: latest }, { label: "Previous", attempt: previous }].map(({ label, attempt }) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{attempt ? value(attempt) : "—"}</dd>
            {attempt ? <dd className="mt-0.5 text-[11px] text-muted-foreground">{formatDay(attempt.day, today)}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs">{change}</p>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Work and loads</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {series.work.map((work, index) => (
            <li key={index}>
              {work.name}: {series.kind === "station" ? `${formatAmount(work.completed)}/` : ""}{formatAmount(work.target)} {work.unit}
              {" · "}{work.kg === null ? "load not recorded" : formatWeight(work.kg, unit)}
            </li>
          ))}
        </ul>
      </details>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Attempt history · {series.attempts.length}</summary>
        <table className="mt-2 w-full tabular-nums">
          <caption className="sr-only">Matching {series.name} attempts, newest first</caption>
          <thead><tr className="text-muted-foreground"><th scope="col" className="py-1 text-left font-normal">Date</th><th scope="col" className="py-1 text-right font-normal">{byTime ? "Time" : "Work completed"}</th></tr></thead>
          <tbody>{series.attempts.slice(0, shown).map((attempt, index) => (
            <tr key={`${attempt.id}-${index}`} className="border-t"><td className="py-2">{formatDay(attempt.day, today)}</td><td className="py-2 text-right">{value(attempt)}</td></tr>
          ))}</tbody>
        </table>
        {series.attempts.length > shown ? <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setShown((count) => count + 10)}>Show older attempts</Button> : null}
      </details>
    </section>
  );
}

export function Benchmarks({ records, today, unit }: { records: RecordItem[]; today: string; unit: WeightUnit }) {
  const [athlete, setAthlete] = useState<Athlete>("hippos");
  const [kind, setKind] = useState<"circuit" | "station">("circuit");
  const [station, setStation] = useState(METCON[0].name);
  const series = useMemo(() => benchmarkSeries(records, athlete, today), [records, athlete, today]);
  const matching = series.filter((group) => group.kind === kind && (kind === "circuit" || group.name === station));
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">ATHX benchmarks</h2>
        <p className="text-xs text-muted-foreground">Actual circuit times and station splits. Comparisons keep work, loads and solo/pairs context the same. Completed circuits, time caps and unfinished attempts stay separate; an unknown load only matches another unknown load.</p>
        <div role="group" aria-label="Benchmark athlete" className="flex flex-wrap gap-2">
          {(["hippos", "gators", "team"] as const).map((who) => <Button key={who} type="button" size="sm" variant={athlete === who ? "default" : "outline"} aria-pressed={athlete === who} onClick={() => setAthlete(who)}>{ATHLETES[who].name}</Button>)}
        </div>
        <div role="group" aria-label="Benchmark type" className="flex gap-2">
          <Button type="button" size="sm" variant={kind === "circuit" ? "default" : "outline"} aria-pressed={kind === "circuit"} onClick={() => setKind("circuit")}>Circuit</Button>
          <Button type="button" size="sm" variant={kind === "station" ? "default" : "outline"} aria-pressed={kind === "station"} onClick={() => setKind("station")}>Stations</Button>
        </div>
        {kind === "station" ? <NativeSelect aria-label="ATHX station" value={station} onChange={(event) => setStation(event.target.value)}>{METCON.map((item) => <NativeSelectOption key={item.name} value={item.name}>{item.name}</NativeSelectOption>)}</NativeSelect> : null}
      </section>
      {matching.length ? matching.map((group) => <AttemptCard key={`${athlete}-${group.key}`} series={group} unit={unit} today={today} />)
        : <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">{kind === "circuit" ? "No timed ATHX circuits for this athlete yet. Log the seven stations in order as a MetCon with an elapsed time. Mixed-session clocks are excluded because they also include other work." : "No timed attempts at this station yet. Add completed work and a station split to a session."}</p>}
    </div>
  );
}
