"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SCALE_MAX, SCALE_MIN, readScale } from "@/lib/meal-dishes";
import { TRACK_LENGTH, TRACK_MAX, TRACK_TICKS, stepSize, trackPercent, trackPosition } from "@/lib/size-track";

/** A percentage as the size box shows it: to a tenth. */
const shownPercent = (percent: number) => String(Math.round(percent * 10) / 10);

/**
 * Where a size's centre is across the track. The handle is 16px wide and
 * stops at the track's ends, so its centre runs from 8px in to 8px short.
 */
const across = (percent: number) => `calc(8px + ${trackPosition(percent) / TRACK_LENGTH} * (100% - 16px))`;

/** What a key does to the size: a 5% step, five of them, or either end. */
const KEYS: Record<string, (percent: number) => number> = {
  ArrowRight: (percent) => stepSize(percent, 1),
  ArrowUp: (percent) => stepSize(percent, 1),
  ArrowLeft: (percent) => stepSize(percent, -1),
  ArrowDown: (percent) => stepSize(percent, -1),
  PageUp: (percent) => stepSize(percent, 5),
  PageDown: (percent) => stepSize(percent, -5),
  Home: () => SCALE_MIN,
  End: () => TRACK_MAX,
};

/**
 * A meal, a dish or an item made bigger or smaller, by a percentage, in one
 * slim row under its figures: a slider from 0% to 200%, and the size it is
 * at, which can be typed into, up to 1000%. The slider gives 50% to 125% the
 * middle of its track, where most sizes are, with ticks to show it, and
 * moves in 5% steps. It sits at 100% and quiet until it is moved, and then
 * says what 100% was. A size the box can take applies at once, so the
 * figures follow the typing; one it cannot is said under it and dropped on
 * leaving the box.
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2">
        <input
          type="range"
          aria-label={label}
          aria-valuetext={`${shownPercent(percent)}%`}
          min={0}
          max={TRACK_LENGTH}
          step={1}
          value={trackPosition(percent)}
          disabled={disabled}
          // The track is drawn here rather than left to the browser, so the
          // handle is the same size everywhere and the ticks sit under it.
          style={{
            "--size-fill": `linear-gradient(to right, var(--primary) ${across(percent)}, var(--input) 0)`,
          } as React.CSSProperties}
          className="h-6 w-full min-w-0 cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default disabled:opacity-50 [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:ring-ring/50 focus-visible:[&::-moz-range-thumb]:ring-4 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-input [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-(image:--size-fill) [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:ring-ring/50 focus-visible:[&::-webkit-slider-thumb]:ring-4"
          onChange={(event) => onPercent(trackPercent(event.target.valueAsNumber))}
          onKeyDown={(event) => {
            const move = KEYS[event.key];
            if (!move) return;
            // The track's own step is a position, not 5%.
            event.preventDefault();
            const next = move(percent);
            if (next !== percent) onPercent(next);
          }}
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
        <div aria-hidden className="relative col-start-1 -mt-1 h-3 text-[10px] leading-3 text-muted-foreground tabular-nums">
          {TRACK_TICKS.map((tick) => (
            <span key={tick} className="absolute top-0 -translate-x-1/2" style={{ left: across(tick) }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
      {unreadable ? (
        <p className="text-right text-[11px] text-muted-foreground">
          {SCALE_MIN}% to {SCALE_MAX}%
        </p>
      ) : null}
    </div>
  );
}
