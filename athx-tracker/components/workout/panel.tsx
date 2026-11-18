"use client";

import { athleteOutline, type AthleteOutline } from "@/lib/athlete-outline";
import { ATHLETES } from "@/lib/domain";
import type { Side } from "./form-model";

/** A tinted column so it is always obvious whose numbers these are. */
export function Column({ side, children }: { side: Side; children: React.ReactNode }) {
  return (
    <div
      className="min-w-0 space-y-2 rounded-lg border p-2.5"
      style={{ borderColor: `${ATHLETES[side].color}44` }}
    >
      <p
        className="flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: ATHLETES[side].ink }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: ATHLETES[side].color }}
        />
        {ATHLETES[side].name}
      </p>
      {children}
    </div>
  );
}

export function Panel({
  title,
  note,
  action,
  outline,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  outline: AthleteOutline;
  children: React.ReactNode;
}) {
  return (
    <section {...athleteOutline(outline)} className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {note ? (
            <p className="text-[11px] text-muted-foreground">{note}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
