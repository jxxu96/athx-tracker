"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATHLETES, formatTime, fromKilograms, type Macros, type RecordItem, type WeightUnit } from "@/lib/domain";
import { addDays, dayToDate, weekStart } from "@/lib/client";
import { formatAmount } from "@/lib/fuel";
import { benchmarkImprovements } from "@/lib/benchmarks";
import { reviewPeriod, reviewWindows, type ReviewAthlete } from "@/lib/weekly-review";

const MACROS = [{ key: "calories", name: "Calories", unit: "kcal" }, { key: "protein", name: "Protein", unit: "g" }, { key: "carbs", name: "Carbs", unit: "g" }, { key: "fat", name: "Fat", unit: "g" }] as const satisfies readonly { key: keyof Macros; name: string; unit: string }[];
const date = (day: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(dayToDate(day));
const range = (start: string, end: string) => `${date(start)} – ${date(end)}`;
const signed = (value: number) => value === 0 ? "No change" : `${value > 0 ? "+" : "−"}${formatAmount(Math.abs(value))}`;

function AthleteReview({ records, athlete, selected, today, unit }: { records: RecordItem[]; athlete: ReviewAthlete; selected: string; today: string; unit: WeightUnit }) {
  const windows = reviewWindows(selected, today);
  const current = reviewPeriod(records, athlete, windows.current);
  const previous = reviewPeriod(records, athlete, windows.previous);
  const improvements = benchmarkImprovements(records, athlete, windows.current.start, windows.current.end);
  const categories = [...new Set([...current.mix, ...previous.mix].map((item) => item.name))];
  const volume = (kg: number) => formatAmount(fromKilograms(kg, unit));
  return (
    <section aria-label={`${ATHLETES[athlete].name} weekly review`} className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: ATHLETES[athlete].color }} />{ATHLETES[athlete].name}</h3>
      <table className="w-full table-fixed text-xs tabular-nums">
        <caption className="mb-2 text-left text-sm font-medium">Training</caption>
        <thead className="text-muted-foreground"><tr><th scope="col" className="w-[42%] pb-2 text-left font-normal">Logged</th><th scope="col" className="pb-2 text-right font-normal">Selected week</th><th scope="col" className="pb-2 text-right font-normal">Previous</th></tr></thead>
        <tbody>
          {[
            ["Sessions", formatAmount(current.sessions), formatAmount(previous.sessions)],
            ["Timed work", current.sessions ? formatTime(current.seconds) : "—", previous.sessions ? formatTime(previous.seconds) : "—"],
            ["Endurance distance", `${Number((current.metres / 1000).toFixed(2))} km`, `${Number((previous.metres / 1000).toFixed(2))} km`],
            [`Lift volume (${unit} × reps)`, volume(current.liftedKg), volume(previous.liftedKg)],
          ].map(([name, now, before]) => <tr key={name} className="border-t"><th scope="row" className="py-2 text-left font-normal">{name}</th><td className="py-2 text-right font-medium">{now}</td><td className="py-2 text-right text-muted-foreground">{before}</td></tr>)}
        </tbody>
      </table>
      {current.untimed || previous.untimed ? <p className="!mt-2 text-[11px] text-muted-foreground">Sessions without times: {current.untimed} selected, {previous.untimed} previous.</p> : null}
      {categories.length ? <div>
        <h4 className="mb-2 text-xs font-medium">Training mix <span className="font-normal text-muted-foreground">· selected / previous</span></h4>
        <div className="flex flex-wrap gap-2">{categories.map((name) => <span key={name} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs">{name} <span className="ml-1 tabular-nums">{current.mix.find((item) => item.name === name)?.count ?? 0} / {previous.mix.find((item) => item.name === name)?.count ?? 0}</span></span>)}</div>
      </div> : <p className="text-xs text-muted-foreground">No training logged in either period.</p>}
      <div>
        <h4 className="text-sm font-medium">Benchmark improvements</h4>
        {improvements.length ? <ul className="mt-2 space-y-2 text-xs">{improvements.slice(0, 4).map(({ series, saved, current: attempt }) => <li key={series.key}>{series.name} · {series.context === "pairs" ? "Pairs" : "Solo"}: <span className="font-medium">{formatTime(saved)} faster</span> ({formatTime(attempt.seconds)})</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">No faster benchmarks.</p>}
        {improvements.length > 4 ? <p className="mt-2 text-xs text-muted-foreground">{improvements.length - 4} more improvements in ATHX benchmarks.</p> : null}
      </div>
      <div>
        <table className="w-full table-fixed text-xs tabular-nums">
          <caption className="mb-2 text-left text-sm font-medium">Nutrition · daily average</caption>
          <thead className="text-muted-foreground"><tr><th scope="col" className="w-[28%] pb-2 text-left font-normal">Macro</th><th scope="col" className="pb-2 text-right font-normal">Selected</th><th scope="col" className="pb-2 text-right font-normal">Previous</th><th scope="col" className="pb-2 text-right font-normal">Change</th></tr></thead>
          <tbody>{MACROS.map(({ key, name, unit: macroUnit }) => <tr key={key} className="border-t"><th scope="row" className="py-2 text-left font-normal">{name}<span className="block text-[10px] text-muted-foreground">{macroUnit}/day</span></th><td className="py-2 text-right font-medium">{current.daysWithMeals ? formatAmount(current.average[key]) : "—"}</td><td className="py-2 text-right text-muted-foreground">{previous.daysWithMeals ? formatAmount(previous.average[key]) : "—"}</td><td className="py-2 text-right">{current.daysWithMeals && previous.daysWithMeals ? signed(Math.round(current.average[key]) - Math.round(previous.average[key])) : "—"}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted-foreground">Days with meals: {current.daysWithMeals} selected, {previous.daysWithMeals} previous.</p>
        {current.pendingMeals || previous.pendingMeals ? <p className="mt-1 text-[11px] text-muted-foreground">Estimates pending: {current.pendingMeals} selected, {previous.pendingMeals} previous. These meals are excluded until their macros arrive.</p> : null}
      </div>
    </section>
  );
}

export function WeeklyReview({ records, today, unit }: { records: RecordItem[]; today: string; unit: WeightUnit }) {
  const thisWeek = weekStart(today);
  const [selected, setSelected] = useState(thisWeek);
  const windows = reviewWindows(selected, today);
  const team = records.filter((record) => record.kind === "workout" && record.athlete === "team" && record.day >= windows.current.start && record.day <= windows.current.end).length;
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Weekly review</h2>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous week" onClick={() => setSelected(addDays(selected, -7))}><ChevronLeft /></Button>
          <p aria-live="polite" className="text-center text-xs font-medium">{range(windows.current.start, windows.current.end)}</p>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next week" disabled={selected >= thisWeek} onClick={() => setSelected(addDays(selected, 7))}><ChevronRight /></Button>
        </div>
        <p className="text-xs text-muted-foreground">Compared with {range(windows.previous.start, windows.previous.end)}.</p>
        {selected !== thisWeek ? <Button type="button" size="sm" variant="outline" onClick={() => setSelected(thisWeek)}>This week</Button> : null}
      </section>
      {(["hippos", "gators"] as const).map((athlete) => <AthleteReview key={athlete} records={records} athlete={athlete} selected={selected} today={today} unit={unit} />)}
      {team > 0 ? <p className="text-xs text-muted-foreground">{team} Together session{team === 1 ? " has" : "s have"} no individual athlete and {team === 1 ? "is" : "are"} excluded from these athlete summaries.</p> : null}
    </div>
  );
}
