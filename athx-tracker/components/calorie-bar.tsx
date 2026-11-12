"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MacroShares } from "@/lib/fuel";

export const FUEL_OVER_HATCH = "repeating-linear-gradient(-45deg, transparent 0 2px, var(--muted) 2px 4px)";

export type CalorieSlice = {
  key: keyof MacroShares | "other";
  label: string;
  share: number;
  size: number;
  color: string;
};

type ComponentKey = CalorieSlice["key"];

function percent(share: number) {
  const rounded = Math.round(share);
  return rounded ? `${rounded}%` : "<1%";
}

export function CalorieBar({
  slices,
  fill,
  targetAt,
}: {
  slices: CalorieSlice[];
  fill: number;
  targetAt: number | null;
}) {
  const [preview, setPreview] = useState<ComponentKey | "bar" | null>(null);
  const [pinned, setPinned] = useState(false);
  const [selected, setSelected] = useState<ComponentKey | null>(null);
  const open = pinned || preview !== null;
  const active = preview && preview !== "bar" ? preview : selected;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedSlice = slices.find(({ key }) => key === selected);
  const exceedsTotal = slices.reduce((sum, slice) => sum + slice.share, 0) > 100.01;
  const estimateNote = exceedsTotal ? "Macro estimates exceed logged calories." : "";

  const dismiss = useCallback(() => {
    setPinned(false);
    setPreview(null);
    setSelected(null);
  }, []);

  function sliceAt(target: EventTarget) {
    const key = target instanceof Element
      ? target.closest<HTMLElement>("[data-fuel-slice]")?.dataset.fuelSlice
      : undefined;
    return slices.find((slice) => slice.key === key)?.key ?? null;
  }

  function select(key: ComponentKey | null) {
    setSelected(key);
    setPinned(true);
    setPreview((current) => current === null ? null : key ?? "bar");
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: MouseEvent) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target)) dismiss();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss();
    }
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, dismiss]);

  return (
    <div>
      <button
        ref={trigger}
        type="button"
        aria-label="Calorie breakdown"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={`${id}-description`}
        className="flex min-h-11 w-full cursor-pointer items-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-7"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setPreview(sliceAt(event.target) ?? "bar");
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse" || preview === null) return;
          const key = sliceAt(event.target);
          if (key) setPreview(key);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setPreview(null);
        }}
        onClick={(event) => {
          const key = sliceAt(event.target);
          if (open && key === null) dismiss();
          else select(key);
        }}
        onKeyDown={(event) => {
          if (!open || slices.length === 0) return;
          if (event.key === "Tab") dismiss();
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = slices.findIndex(({ key }) => key === active);
          const next = event.key === "ArrowRight"
            ? (index + 1) % slices.length
            : (Math.max(index, 0) + slices.length - 1) % slices.length;
          select(slices[next].key);
        }}
      >
        <span className="block min-w-0 flex-1">
          <span id={id} data-fuel-labels="" hidden={!open} className="block">
            <span className="flex min-h-11 overflow-hidden rounded-t-md">
              {slices.map(({ key, label, color, share, size }) => (
                <span
                  key={key}
                  data-fuel-slice={key}
                  data-active={active === key ? "" : undefined}
                  className="flex min-w-min flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-xs leading-none text-neutral-950 data-active:font-semibold data-active:ring-2 data-active:ring-neutral-950 data-active:ring-inset"
                  style={{ flexGrow: size, flexBasis: 0, background: `color-mix(in srgb, ${color} 58%, white)` }}
                >
                  <span>{label}</span>
                  <span className="text-sm font-semibold tabular-nums">{percent(share)}</span>
                </span>
              ))}
            </span>
            {estimateNote ? (
              <span className="block bg-muted px-1.5 py-0.5 text-left text-[11px] text-muted-foreground">
                {estimateNote}
              </span>
            ) : null}
          </span>
          {/* The lower edge keeps the real calorie and target proportions when labels need more room. */}
          <span className="relative block">
            <span className={`block h-2 overflow-hidden bg-muted ${open ? "rounded-b-md" : "rounded-full"}`}>
              <span className="flex h-full gap-px overflow-hidden" style={{ width: `${fill}%` }}>
                {slices.map(({ key, color, size }) => (
                  <span
                    key={key}
                    data-fuel-slice={key}
                    className="h-full"
                    style={{ flexGrow: size, flexBasis: 0, background: color }}
                  />
                ))}
              </span>
              {targetAt !== null ? (
                <span
                  data-fuel-over=""
                  className="pointer-events-none absolute inset-y-0 right-0 rounded-r-full opacity-75"
                  style={{ left: `${targetAt}%`, backgroundImage: FUEL_OVER_HATCH }}
                />
              ) : null}
            </span>
            {targetAt !== null ? (
              <span
                data-fuel-target=""
                className="pointer-events-none absolute top-1/2 z-10 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
                style={{ left: `${targetAt}%` }}
              />
            ) : null}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`ml-1.5 size-4 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`} />
      </button>
      <span id={`${id}-description`} className="sr-only">
        {open
          ? `Estimated share of logged calories. ${slices.map(({ label, share }) => `${label} ${percent(share)}`).join(", ")}. ${estimateNote} Use the Left and Right arrow keys to select a component.`
          : "Press Enter or Space to show each component’s share of logged calories."}
      </span>
      <span role="status" className="sr-only">
        {open && selectedSlice ? `${selectedSlice.label}, ${percent(selectedSlice.share)} selected` : ""}
      </span>
    </div>
  );
}
