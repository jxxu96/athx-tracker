"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SCALE_MAX, SCALE_MIN, SCALE_SLIDER, readScale } from "@/lib/meal-dishes";

/** A percentage as the size box shows it: to a tenth. */
const shownPercent = (percent: number) => String(Math.round(percent * 10) / 10);

/**
 * A dish or an item made bigger or smaller, by a percentage, in one slim row
 * under its figures: a slider, and the size it is at, which can be typed
 * into. It sits at 100% and quiet until it is moved, and then says what 100%
 * was. A size the box can take applies at once, so the figures follow the
 * typing; one it cannot is said under it and dropped on leaving the box.
 */
export function SizeSlider({
  label = "Size",
  percent,
  full,
  disabled = false,
  onPercent,
}: {
  /** The slider's name; the box is the same with "(%)". */
  label?: string;
  percent: number;
  /** Calories at 100%, said once the size is anything else. */
  full: number | null;
  disabled?: boolean;
  onPercent: (percent: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const unreadable = typed !== null && typed.trim() !== "" && readScale(typed) === null;
  const resized = Math.round(percent * 10) !== 1000;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="h-6 min-w-0 flex-1 accent-primary"
          aria-label={label}
          aria-valuetext={`${shownPercent(percent)}%`}
          min={SCALE_SLIDER.min}
          max={SCALE_SLIDER.max}
          step={SCALE_SLIDER.step}
          value={Math.min(SCALE_SLIDER.max, Math.max(SCALE_SLIDER.min, percent))}
          disabled={disabled}
          onChange={(event) => onPercent(event.target.valueAsNumber)}
        />
        <div className="relative w-16 shrink-0">
          <Input
            aria-label={`${label} (%)`}
            value={typed ?? shownPercent(percent)}
            inputMode="decimal"
            disabled={disabled}
            aria-invalid={unreadable || undefined}
            // Text until it is touched: the box shows on hover and focus. Kept
            // at 16px on a phone, where anything smaller zooms the page on focus.
            className={`h-7 border-transparent bg-transparent pr-5 pl-1 text-right tabular-nums shadow-none hover:border-input dark:bg-transparent ${resized ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            onFocus={() => setTyped(shownPercent(percent))}
            onBlur={() => setTyped(null)}
            onChange={(event) => {
              const text = event.target.value;
              setTyped(text);
              const value = readScale(text);
              if (value !== null) onPercent(value);
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-sm text-muted-foreground"
          >
            %
          </span>
        </div>
        {resized && full !== null && full > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">of {Math.round(full * 10) / 10} kcal</span>
        ) : null}
      </div>
      {unreadable ? (
        <p className="text-right text-[11px] text-muted-foreground">
          {SCALE_MIN}% to {SCALE_MAX}%
        </p>
      ) : null}
    </div>
  );
}
