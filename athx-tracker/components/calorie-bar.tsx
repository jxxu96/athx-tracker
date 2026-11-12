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
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback((restoreFocus = false) => {
    if (restoreFocus && root.current?.contains(document.activeElement)) trigger.current?.focus();
    setPinned(false);
    setPreview(null);
    setSelected(null);
  }, []);

  function select(key: ComponentKey | null) {
    setSelected(key);
    setPinned(true);
    setPreview((current) => current === null ? null : key ?? "bar");
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss(true);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, dismiss]);

  return (
    <div
      ref={root}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setPreview(null);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Calorie breakdown"
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full cursor-pointer items-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-7"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setPreview("bar");
        }}
        onClick={(event) => {
          const key = event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-fuel-slice]")?.dataset.fuelSlice
            : undefined;
          const segment = slices.find((component) => component.key === key);
          if (pinned && !segment) {
            dismiss();
          } else {
            select(segment?.key ?? null);
          }
        }}
      >
        <span className="relative block flex-1">
          <span className={`block overflow-hidden rounded-full bg-muted ${open ? "h-4" : "h-2"}`}>
            <span className="flex h-full gap-px overflow-hidden rounded-full" style={{ width: `${fill}%` }}>
              {slices.map(({ key, color, size }) => (
                <span
                  key={key}
                  data-fuel-slice={key}
                  className={`h-full ${active === key ? "z-10 outline-2 -outline-offset-2 outline-solid outline-foreground" : ""}`}
                  style={{ flexGrow: size, flexBasis: 0, background: color }}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") {
                      setPreview((current) => current === null ? null : key);
                    }
                  }}
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
              className="pointer-events-none absolute top-1/2 z-10 h-[calc(100%+4px)] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
              style={{ left: `${targetAt}%` }}
            />
          ) : null}
        </span>
        <ChevronDown aria-hidden="true" className={`ml-1.5 size-4 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={id}
        role="group"
        aria-labelledby={`${id}-title`}
        hidden={!open}
        className="rounded-lg border bg-muted/30 px-2 pb-2"
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <p id={`${id}-title`} className="text-xs text-muted-foreground">Estimated share of logged calories</p>
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="min-h-8 shrink-0 cursor-pointer rounded px-1 text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Close
          </button>
        </div>
        <ul className="space-y-0.5">
          {slices.map(({ key, label, color, share }) => (
            <li key={key}>
              <button
                type="button"
                aria-pressed={active === key}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm tabular-nums aria-pressed:bg-background aria-pressed:font-semibold aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") {
                    setPreview((current) => current === null ? null : key);
                  }
                }}
                onClick={() => select(key)}
              >
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
                <span className="flex-1">{label}</span>
                <span>{percent(share)}</span>
              </button>
            </li>
          ))}
        </ul>
        {slices.reduce((sum, slice) => sum + slice.share, 0) > 100.01 ? (
          <p className="px-1 pt-2 text-xs text-muted-foreground">Macro estimates exceed logged calories.</p>
        ) : null}
      </div>
    </div>
  );
}
