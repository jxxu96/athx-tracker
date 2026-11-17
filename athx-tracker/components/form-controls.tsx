"use client";

/**
 * Controls every form shares: a labelled field, the Today / Yesterday /
 * Calendar date picker, and a row of choice buttons.
 */
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
} from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { athleteOutline, type AthleteOutline } from "@/lib/athlete-outline";
import { addDays, dayToDate } from "@/lib/client";
import { localDay } from "@/lib/domain";

/** The calendar button names a day that is neither today nor yesterday. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayToDate(day));

/** Local midnight, so the calendar's day is the day in the string. */
const parseDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
};

/**
 * A date button. The chosen one takes the primary fill, as a chosen sitting
 * does: accent on a card was too faint to see which day was picked.
 */
const DAY_CHOICE =
  "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

export function DayButtons({
  today,
  day,
  onChange,
  time,
  onTimeChange,
  subject,
}: {
  today: string;
  day: string;
  onChange: (next: string) => void;
  /** When given, the time of day sits under the date. Blank is not recorded. */
  time?: string;
  onTimeChange?: (next: string) => void;
  /**
   * What the date is for, when the screen has another Today button: the
   * buttons are then named "Energy today" rather than a second "Today" beside
   * the tab of that name.
   */
  subject?: string;
}) {
  const named = (what: string) => (subject ? `${subject} ${what[0].toLowerCase()}${what.slice(1)}` : undefined);
  const yesterday = addDays(today, -1);
  const custom = day !== today && day !== yesterday;
  const [open, setOpen] = useState(false);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Date
      </Label>
      <div role="group" aria-label={subject ? `${subject} date` : "Date"} className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => choose(today)}
          aria-pressed={day === today}
          aria-label={named("Today")}
          className={DAY_CHOICE}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => choose(yesterday)}
          aria-pressed={day === yesterday}
          aria-label={named("Yesterday")}
          className={DAY_CHOICE}
        >
          Yesterday
        </button>
        <div className="min-w-0">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-pressed={custom}
                aria-label={named(custom ? `Calendar, ${shortDay(day)}` : "Calendar") ?? (custom ? `Calendar, ${shortDay(day)}` : "Calendar")}
                className={`${DAY_CHOICE} w-full`}
              >
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{custom ? shortDay(day) : "Calendar"}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={parseDay(day)}
                defaultMonth={parseDay(day)}
                disabled={{ after: parseDay(today) }}
                onSelect={(selected) => {
                  if (!selected) return;
                  const next = localDay(selected);
                  if (next > today) return;
                  choose(next);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {onTimeChange ? (
        <Field label="Time of day" className="mt-3">
          <Input
            type="time"
            value={time ?? ""}
            className="w-36"
            onChange={(event) => onTimeChange(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  // The label sat beside the control rather than attached to it, so nothing
  // announced what any field was, and nothing could find one by its name.
  const generated = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, {
        id: (children as ReactElement<{ id?: string }>).props.id ?? generated,
      })
    : children;
  const htmlFor = isValidElement(children)
    ? ((children as ReactElement<{ id?: string }>).props.id ?? generated)
    : undefined;

  return (
    <div className={className}>
      <Label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      <div className="[&>div]:w-full">{control}</div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  fit = false,
}: {
  label: string;
  /** Null shows none of them chosen. */
  value: T | null;
  /**
   * detail is drawn after the label, for the eye only; name, when given, is
   * what the button is read as instead of its label, and should begin with it.
   */
  options: readonly { value: T; label: string; outline?: AthleteOutline; detail?: React.ReactNode; name?: string }[];
  onChange: (next: T) => void;
  /**
   * Columns as wide as their labels, then stretched to fill the row. Five
   * equal columns on a phone cut "Breakfast" to "Breakfa".
   */
  fit?: boolean;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div
        role="group"
        aria-label={label}
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${options.length}, ${fit ? "minmax(0, auto)" : "minmax(0, 1fr)"})`,
        }}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              aria-label={option.name}
              {...(selected && option.outline ? athleteOutline(option.outline, "accent") : {})}
              // An athlete is told apart by its coloured ring. A plain option has
              // only its fill, and accent on a card was too faint to see which
              // one was chosen, so it takes the primary fill instead. It stays
              // the same weight: a bolder label would widen a fitted column and
              // shift the row on every tap.
              className={`rounded-lg py-2.5 text-xs font-medium transition-colors ${fit ? "px-1.5" : "px-2"} ${
                option.outline
                  ? "border-2 aria-pressed:bg-accent aria-pressed:font-semibold"
                  : "border aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              }`}
            >
              {option.label}
              {option.detail ? <span aria-hidden="true">{option.detail}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
