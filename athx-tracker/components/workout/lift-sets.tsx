"use client";

import { Plus, X } from "lucide-react";
import { Field } from "@/components/form-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ATHLETES,
  formatLiftSets,
  formatWeight,
  liftTop,
  parseLoad,
  type WeightUnit,
} from "@/lib/domain";
import type { LastLift } from "@/lib/last-lift";
import { num, type LiftSide, type SetDraft, type Side } from "./form-model";
import { Column } from "./panel";

/** One athlete's sets: one weight for all of them, or a row for each. */
export function LiftSets({
  side,
  entry,
  unit,
  liftName,
  last,
  lastDay,
  onUseLast,
  onToggle,
  onSimple,
  onSet,
  onAdd,
  onRemove,
}: {
  side: Side;
  entry: LiftSide;
  unit: WeightUnit;
  liftName: string;
  /** This athlete's last time at the lift, offered to copy. */
  last: LastLift | null;
  lastDay: string;
  onUseLast: () => void;
  onToggle: () => void;
  onSimple: (patch: Partial<Pick<LiftSide, "kg" | "sets" | "reps">>) => void;
  onSet: (index: number, patch: Partial<SetDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const who = ATHLETES[side].name;
  const parsed = entry.detail.flatMap((set, index) => {
    const kg = parseLoad(set.kg, unit, set.savedKg);
    const reps = Math.round(num(set.reps) || 0);
    return kg !== null && reps >= 1 ? [{ kg, reps, failed: Boolean(set.failed), index }] : [];
  });
  const missed = parsed.flatMap((set) => (set.failed ? [set.index + 1] : []));
  const same = parsed.length > 0 && parsed.every((set) => set.kg === parsed[0].kg && set.reps === parsed[0].reps);
  const top = parsed.length > 0 ? liftTop(parsed.map(({ kg, reps }) => ({ kg, reps }))) : null;
  const lastSets = last ? formatLiftSets(last.lift, unit) : "";
  return (
    <Column side={side}>
      {last ? (
        <button
          type="button"
          onClick={onUseLast}
          aria-label={`Use ${who}' last ${liftName}: ${lastSets}, ${lastDay}`}
          className="flex w-full items-baseline justify-between gap-2 rounded-md border border-dashed px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted"
        >
          <span className="min-w-0">
            Last <span className="font-medium tabular-nums text-foreground">{lastSets}</span> · {lastDay}
          </span>
          <span className="shrink-0 font-medium text-foreground">Use</span>
        </button>
      ) : null}
      <div>
        <Button
          type="button"
          variant={entry.advanced ? "secondary" : "outline"}
          size="xs"
          aria-pressed={entry.advanced}
          aria-label={`${who} advanced sets`}
          onClick={onToggle}
        >
          Advanced
        </Button>
      </div>
      {entry.advanced ? (
        <>
          <ul className="space-y-2">
            {entry.detail.map((set, index) => (
              <li key={index} className="flex items-end gap-2">
                <Field label={unit} className="min-w-0 flex-1">
                  <Input
                    value={set.kg}
                    inputMode="decimal"
                    className="h-8"
                    aria-label={`${who} set ${index + 1} weight`}
                    onChange={(event) => onSet(index, { kg: event.target.value })}
                  />
                </Field>
                <Field label="Reps" className="min-w-0 flex-1">
                  <Input
                    value={set.reps}
                    inputMode="numeric"
                    className="h-8"
                    aria-label={`${who} set ${index + 1} reps`}
                    onChange={(event) => onSet(index, { reps: event.target.value })}
                  />
                </Field>
                <Field label="Fail" className="w-9 shrink-0">
                  <div className="flex h-8 items-center justify-center">
                    <Checkbox
                      checked={Boolean(set.failed)}
                      aria-label={`${who} set ${index + 1} failed the final rep`}
                      title="Failed the final rep"
                      onCheckedChange={(value) => onSet(index, { failed: value === true })}
                    />
                  </div>
                </Field>
                {entry.detail.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${who} remove set ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {entry.detail.length < 50 ? (
            <Button type="button" variant="outline" size="xs" aria-label={`${who} add set`} onClick={onAdd}>
              <Plus /> Set
            </Button>
          ) : null}
          {top ? (
            <p className="text-[11px] text-muted-foreground">
              {same
                ? `${parsed.length}×${parsed[0].reps} at ${formatWeight(parsed[0].kg, unit)}`
                : `Heaviest ${formatWeight(top.kg, unit)} ${top.sets}×${top.reps}`}
              {missed.length > 0
                ? ` · last rep failed on set ${missed.join(", ")}`
                : ""}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <Field label={unit}>
            <Input
              value={entry.kg}
              inputMode="decimal"
              className="h-8"
              onChange={(event) => onSimple({ kg: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {/* No placeholder: a grey 3 and 5 read as values and saved as one
                set of one. Choosing the lift fills real defaults instead. */}
            <Field label="Sets">
              <Input
                value={entry.sets}
                inputMode="numeric"
                className="h-8"
                onChange={(event) => onSimple({ sets: event.target.value })}
              />
            </Field>
            <Field label="Reps">
              <Input
                value={entry.reps}
                inputMode="numeric"
                className="h-8"
                onChange={(event) => onSimple({ reps: event.target.value })}
              />
            </Field>
          </div>
        </>
      )}
    </Column>
  );
}
