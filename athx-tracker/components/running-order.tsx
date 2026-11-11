"use client";

import { daysBetween, formatDay } from "@/lib/client";
import { ATHLETES, formatWeight, type WeightUnit } from "@/lib/domain";
import { RACE_ATHLETES } from "@/lib/race";
import {
  DUE_DAYS,
  FRESH_DAYS,
  RUNNING_ORDER,
  recency,
  seenLabel,
  seenSpoken,
  staleCount,
  type Recency,
  type Seen,
  type SeenTable,
} from "@/lib/running-order";

/** Each zone's steps with their place in the whole day, 1 to 12. */
const NUMBERED = RUNNING_ORDER.map((zone, index) => {
  const before = RUNNING_ORDER.slice(0, index).reduce((sum, earlier) => sum + earlier.steps.length, 0);
  return { ...zone, steps: zone.steps.map((step, at) => ({ ...step, number: before + at + 1 })) };
});
const STEPS = RUNNING_ORDER.reduce((sum, zone) => sum + zone.steps.length, 0);

/** The pill: its colour is how long ago, and its words say the same for anyone who cannot see it. */
function Pill({ band, children }: { band: Recency; children: React.ReactNode }) {
  return (
    <span
      data-recency={band}
      className="inline-flex items-center gap-1 rounded-full bg-(--recency-fill) px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap tabular-nums text-(--recency-ink)"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--recency)" />
      {children}
    </span>
  );
}

/**
 * When one of you last did a workout. The day itself shows beside it where
 * there is room, is on hover where there is not, and is always read out.
 * Today and yesterday are already their own day.
 */
function Since({ seen, today }: { seen: Seen; today: string }) {
  const day = seen && !seen.onOrBefore && daysBetween(seen.day, today) > 1 ? formatDay(seen.day, today) : null;
  return (
    <span title={day ? `Last done ${day}` : undefined} className="whitespace-nowrap">
      <Pill band={recency(seen, today)}>
        <span aria-hidden="true">{seenLabel(seen, today)}</span>
        <span className="sr-only">
          Last done {seenSpoken(seen, today)}
          {day ? `, ${day}` : ""}
        </span>
      </Pill>
      {day ? (
        <span aria-hidden="true" className="ml-1.5 hidden text-[11px] text-muted-foreground sm:inline">
          {day}
        </span>
      ) : null}
    </span>
  );
}

/** The folded line: how many workouts each of you has let go red. */
export function runningOrderLine(seen: SeenTable, today: string) {
  const counts = RACE_ATHLETES.map((athlete) => ({ athlete, stale: staleCount(seen, athlete, today) }));
  if (counts.every(({ stale }) => stale === 0)) return `All ${STEPS} done in the last ${DUE_DAYS} days`;
  return `Not done in ${DUE_DAYS} days: ${counts
    .map(({ athlete, stale }) => `${ATHLETES[athlete].name} ${stale}`)
    .join(" · ")}`;
}

/**
 * Race day, every workout in the order it is run, with what each asks of
 * each of you and when each of you last did it: green within FRESH_DAYS,
 * yellow within DUE_DAYS, red past that or never.
 */
export function RunningOrder({ seen, today, unit }: { seen: SeenTable; today: string; unit: WeightUnit }) {
  return (
    <>
      <table className="w-full table-fixed text-left text-xs">
        <caption className="sr-only">
          Race day in order: what each workout asks of each of you, and when each of you last did it
        </caption>
        <colgroup>
          <col className="w-5" />
          <col />
          <col className="w-[4.75rem] sm:w-40" />
          <col className="w-[4.75rem] sm:w-40" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="p-0">
              <span className="sr-only">Order</span>
            </th>
            <th scope="col" className="p-0">
              <span className="sr-only">Workout</span>
            </th>
            {RACE_ATHLETES.map((athlete) => (
              <th
                key={athlete}
                scope="col"
                className="pb-0.5 pl-1.5 text-[11px] font-medium"
                style={{ color: ATHLETES[athlete].ink }}
              >
                <span className="flex items-center gap-1 px-1.5">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: ATHLETES[athlete].color }}
                  />
                  {ATHLETES[athlete].name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {NUMBERED.map((zone) => (
          <tbody key={zone.key}>
            <tr>
              <th scope="rowgroup" colSpan={4} className="pt-3 pb-1.5 text-left font-normal">
                <span className="text-[11px] font-semibold tracking-wider uppercase">{zone.name}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">{zone.time}</span>
              </th>
            </tr>
            {zone.steps.map((step) => (
              <tr key={step.number} className="border-t">
                <td className="py-2 align-top text-[11px] leading-4 tabular-nums text-muted-foreground">
                  {step.number}
                </td>
                <th scope="row" className="py-2 pr-1 align-top font-normal">
                  <span className="block leading-4 font-medium">{step.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    {step.asks.join(" · ")}
                  </span>
                </th>
                {RACE_ATHLETES.map((athlete) => (
                  <td key={athlete} className="py-2 pl-1.5 align-top">
                    <Since seen={seen[athlete][step.movement]} today={today} />
                    {step.kg ? (
                      <span className="mt-0.5 block px-1.5 text-[11px] leading-4 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatWeight(step.kg[athlete], unit)}
                        {step.per ?? ""}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
            {zone.then ? (
              <tr>
                <td colSpan={4} className="pt-1.5 pb-0">
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span aria-hidden="true" className="flex-1 border-t border-dashed" />
                    {zone.then}
                    <span aria-hidden="true" className="flex-1 border-t border-dashed" />
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        ))}
      </table>
      <p className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3 text-[11px] text-muted-foreground">
        <span className="mr-0.5">Last done</span>
        <Pill band="fresh">≤{FRESH_DAYS}d</Pill>
        <Pill band="due">≤{DUE_DAYS}d</Pill>
        <Pill band="stale">&gt;{DUE_DAYS}d or never</Pill>
      </p>
    </>
  );
}
