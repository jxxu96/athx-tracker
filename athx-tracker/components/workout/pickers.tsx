"use client";

import { Field } from "@/components/form-controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { athleteOutline } from "@/lib/athlete-outline";
import { ATHLETES, type DistanceUnit, type Segment } from "@/lib/domain";
import { EXERCISES } from "@/lib/exercises";
import { OTHER, type Format, type Groups } from "./form-model";

const DISTANCE_CHOICES: readonly { value: DistanceUnit; name: string }[] = [
  { value: "m", name: "meters" },
  { value: "km", name: "kilometers" },
  { value: "mi", name: "miles" },
];

/** Metres, kilometres, or miles. The number in the box converts with the choice. */
export function DistanceUnits({
  unit,
  onChange,
}: {
  unit: Segment["unit"];
  onChange: (next: DistanceUnit) => void;
}) {
  return (
    <div role="group" aria-label="Distance unit" className="flex w-fit rounded-full bg-muted p-0.5">
      {DISTANCE_CHOICES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.name}
          aria-pressed={unit === option.value}
          onClick={() => onChange(option.value)}
          className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.value}
        </button>
      ))}
    </div>
  );
}

export function ExercisePicker({
  label,
  choice,
  custom,
  groups = EXERCISES,
  onChoice,
  onCustom,
}: {
  label: string;
  choice: string;
  custom: string;
  /** What the list offers. Other follows it, for anything it lacks. */
  groups?: Groups;
  onChoice: (value: string) => void;
  onCustom: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label={label}>
        <NativeSelect
          size="sm"
          value={choice}
          onChange={(event) => onChoice(event.target.value)}
        >
          <NativeSelectOption value="">Choose…</NativeSelectOption>
          {groups.map((group) => (
            <NativeSelectOptGroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {item}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
          <NativeSelectOption value={OTHER}>Other…</NativeSelectOption>
        </NativeSelect>
      </Field>
      {choice === OTHER ? (
        <Field label="Name it">
          <Input
            value={custom}
            maxLength={80}
            placeholder="Exercise name"
            className="h-8"
            onChange={(event) => onCustom(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

const FORMAT_OPTIONS: readonly {
  value: Format;
  label: string;
  dots: readonly string[];
}[] = [
  { value: "hippos", label: "Hippos", dots: [ATHLETES.hippos.color] },
  { value: "gators", label: "Gators", dots: [ATHLETES.gators.color] },
  {
    value: "pairs",
    label: "Pairs",
    dots: [ATHLETES.hippos.color, ATHLETES.gators.color],
  },
];

export function FormatButtons({
  value,
  onChange,
}: {
  value: Format;
  onChange: (next: Format) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Format
      </Label>
      <div role="group" aria-label="Format" className="grid grid-cols-3 gap-1.5">
        {FORMAT_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              {...(selected
                ? athleteOutline(option.value === "pairs" ? "both" : option.value, "accent")
                : {})}
              className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors aria-pressed:bg-accent aria-pressed:font-semibold"
            >
              <span className="flex shrink-0 gap-0.5" aria-hidden="true">
                {option.dots.map((color) => (
                  <span
                    key={color}
                    className="size-2 rounded-full"
                    style={{ background: color }}
                  />
                ))}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
