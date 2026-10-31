"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ATHLETES,
  categoryName,
  completionLine,
  distanceLine,
  estimateBurn,
  formatLift,
  formatTimeOrDash,
  type Athlete,
  type RecordItem,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";
import { bodyweightOn, type BodyweightHistory } from "@/lib/bodyweight";
import { addDays, dayToDate, daysBetween, formatDay } from "@/lib/client";
import {
  dayAthletes,
  monthOf,
  monthRange,
  monthWeeks,
  needsFetch,
  rangeCounts,
  sessionsByDay,
  shiftMonth,
  stripDays,
  type Month,
} from "@/lib/session-calendar";
import { cn } from "@/lib/utils";

type View = "week" | "month";

const KEYS = ["hippos", "gators", "team"] as const satisfies readonly Athlete[];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const formatter = (options: Intl.DateTimeFormatOptions) => {
  const format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  return (day: string) => format.format(dayToDate(day));
};
const weekday = formatter({ weekday: "short" });
const longDay = formatter({ weekday: "long", day: "numeric", month: "long" });
const shortDay = formatter({ day: "numeric", month: "short" });
const monthName = formatter({ month: "long", year: "numeric" });
const dayNumber = (day: string) => String(Number(day.slice(8)));
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One dot a session, in the athlete's colour; past four, three and a plus. */
function Dots({ sessions }: { sessions: readonly Workout[] }) {
  const athletes = dayAthletes(sessions);
  const shown = athletes.length > 4 ? athletes.slice(0, 3) : athletes;
  return (
    <span aria-hidden="true" className="flex h-2 items-center justify-center gap-0.5">
      {shown.map((athlete, index) => (
        <span
          key={index}
          className="size-1.5 rounded-full"
          style={{ background: ATHLETES[athlete].color }}
        />
      ))}
      {athletes.length > shown.length ? (
        <span className="text-[9px] font-semibold leading-none text-muted-foreground">+</span>
      ) : null}
    </span>
  );
}

function DayCell({
  day,
  today,
  sessions,
  selected,
  compact,
  onSelect,
}: {
  day: string;
  today: string;
  sessions: readonly Workout[];
  selected: boolean;
  /** The month grid has its weekdays above it, and less room. */
  compact?: boolean;
  onSelect: (day: string) => void;
}) {
  const count = sessions.length;
  return (
    <button
      type="button"
      disabled={day > today}
      aria-pressed={selected}
      onClick={() => onSelect(day)}
      className={cn(
        "group/day flex min-w-0 flex-col items-center rounded-xl transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-muted",
        compact ? "gap-0.5 py-1" : "gap-1 py-2",
      )}
    >
      {/* The name is the whole date and the count; what shows is shorthand
          for it, so it is hidden from the name rather than contradicting it. */}
      <span className="sr-only">
        {`${longDay(day)}${day === today ? ", today" : ""}: ${count ? plural(count, "session") : "no sessions"}`}
      </span>
      {compact ? null : (
        <span aria-hidden="true" className="text-[10px] font-medium text-muted-foreground group-aria-pressed/day:text-foreground">
          {weekday(day)}
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center rounded-full font-semibold tabular-nums",
          compact ? "size-6 text-xs" : "size-7 text-sm",
          day === today && "bg-foreground text-background",
        )}
      >
        {dayNumber(day)}
      </span>
      <Dots sessions={sessions} />
    </button>
  );
}

function SessionItem({
  session,
  history,
  unit,
}: {
  session: Workout;
  history: BodyweightHistory;
  unit: WeightUnit;
}) {
  const who = ATHLETES[session.athlete];
  const burn =
    session.athlete === "team"
      ? null
      : estimateBurn(session, bodyweightOn(history, session.athlete, session.day));
  const details = [
    completionLine(session),
    distanceLine(session),
    session.lifts.length ? session.lifts.map((lift) => formatLift(lift, unit)).join(" · ") : null,
  ].filter((line): line is string => Boolean(line));
  return (
    <li className="flex gap-3 py-2.5 first:pt-1 last:pb-0">
      <span aria-hidden="true" className="w-1 shrink-0 rounded-full" style={{ background: who.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium">{session.title}</p>
          <p className="shrink-0 text-sm font-medium tabular-nums">{formatTimeOrDash(session.seconds)}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {session.time ? `${session.time} · ` : ""}
          <span className="font-medium" style={{ color: who.ink }}>{who.name}</span>
          {` · ${categoryName(session)}`}
          {session.context === "pairs" ? " · Pairs" : ""}
          {burn !== null ? ` · ~${burn} kcal` : ""}
        </p>
        {details.map((line) => (
          <p key={line} className="mt-0.5 text-xs text-muted-foreground">{line}</p>
        ))}
        {session.notes ? (
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
            {session.notes}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function DayGroup({
  day,
  today,
  sessions,
  history,
  unit,
}: {
  day: string;
  today: string;
  sessions: readonly Workout[];
  history: BodyweightHistory;
  unit: WeightUnit;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-muted-foreground">{formatDay(day, today)}</h3>
      <ul className="divide-y">
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} history={history} unit={unit} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The last seven days as a strip, or a month as a grid, with a dot for each
 * session in its athlete's colour. A day opens what was done on it; with none
 * chosen, the strip lists its whole week. Older than the phone's slice of the
 * journal, the days are fetched rather than shown empty.
 */
export function SessionCalendar({
  records,
  history,
  today,
  unit,
  heldFrom,
  onLoad,
  refresh,
}: {
  records: RecordItem[];
  history: BodyweightHistory;
  today: string;
  unit: WeightUnit;
  /** The oldest day the phone holds; null when it holds the whole journal. */
  heldFrom: string | null;
  onLoad: (from: string, to: string) => Promise<void>;
  /** Changes when the journal is fetched again, which drops what was merged in. */
  refresh: number;
}) {
  const [view, setView] = useState<View>("week");
  // Null follows today, so the strip and the month move on when the day does.
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ refresh: number; ranges: string[] }>({ refresh, ranges: [] });
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);

  const thisMonth = monthOf(today);
  const stripEnd = end && end < today ? end : today;
  const shownMonth = month && month < thisMonth ? month : thisMonth;
  const monthDays = monthRange(shownMonth);
  const start = view === "week" ? addDays(stripEnd, -6) : monthDays.start;
  const last = view === "week" ? stripEnd : monthDays.end < today ? monthDays.end : today;
  const key = `${start}:${last}`;
  const ready =
    !needsFetch(heldFrom, start) || (loaded.refresh === refresh && loaded.ranges.includes(key));

  useEffect(() => {
    if (ready) return;
    let active = true;
    onLoad(start, last)
      .then(() => {
        if (!active) return;
        setFailed("");
        setLoaded((current) => ({
          refresh,
          ranges: current.refresh === refresh ? [...current.ranges, key] : [key],
        }));
      })
      .catch(() => {
        if (active) setFailed(key);
      });
    return () => {
      active = false;
    };
  }, [ready, start, last, key, onLoad, refresh, attempt]);

  const days = sessionsByDay(records, start, last);
  const { total, days: trained } = rangeCounts(days);
  const loading = !ready && failed !== key;
  const atLatest = view === "week" ? stripEnd >= today : shownMonth >= thisMonth;

  const move = (step: -1 | 1) => {
    setSelected(null);
    if (view === "week") {
      const next = addDays(stripEnd, step * 7);
      setEnd(next < today ? next : null);
    } else {
      const next = shiftMonth(shownMonth, step);
      setMonth(next < thisMonth ? next : null);
    }
  };
  // The other view opens where this one is, on the chosen day if there is one.
  const show = (next: View) => {
    if (next === view) return;
    if (next === "month") {
      const anchor = monthOf(selected ?? stripEnd);
      setMonth(anchor < thisMonth ? anchor : null);
    } else {
      const anchor = selected ?? last;
      setEnd(anchor < today ? anchor : null);
    }
    setView(next);
  };
  const choose = (day: string) => setSelected((current) => (current === day ? null : day));

  const label =
    view === "month"
      ? monthName(`${shownMonth}-01`)
      : stripEnd === today
        ? "Last 7 days"
        : `${shortDay(start)} – ${shortDay(stripEnd)}`;
  const span = daysBetween(start, last) + 1;
  const chosen = selected ? days.get(selected) ?? [] : [];

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div role="group" aria-label="Calendar view" className="grid grid-cols-2 rounded-full bg-muted p-0.5">
          {(["week", "month"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              onClick={() => show(item)}
              className="rounded-full px-3 py-1 text-[11px] font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm sm:text-xs"
            >
              {item === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={view === "week" ? "Previous 7 days" : "Previous month"}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </Button>
          <p aria-live="polite" className="min-w-0 truncate text-center text-xs font-medium tabular-nums sm:min-w-28">
            {label}
          </p>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={view === "week" ? "Next 7 days" : "Next month"}
            disabled={atLatest}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-50")}>
        {view === "week" ? (
          <div role="group" aria-label="Days" className="grid grid-cols-7 gap-1">
            {stripDays(stripEnd).map((day) => (
              <DayCell
                key={day}
                day={day}
                today={today}
                sessions={days.get(day) ?? []}
                selected={selected === day}
                onSelect={choose}
              />
            ))}
          </div>
        ) : (
          <div role="group" aria-label="Days" className="space-y-0.5">
            <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1 text-center text-[10px] font-medium text-muted-foreground">
              {WEEKDAYS.map((letter, index) => (
                <span key={index}>{letter}</span>
              ))}
            </div>
            {monthWeeks(shownMonth).map((week) => (
              <div key={week.find(Boolean)} className="grid grid-cols-7 gap-1">
                {week.map((day, index) =>
                  day ? (
                    <DayCell
                      key={day}
                      day={day}
                      today={today}
                      sessions={days.get(day) ?? []}
                      selected={selected === day}
                      compact
                      onSelect={choose}
                    />
                  ) : (
                    <span key={`blank-${index}`} />
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {failed === key ? (
        <div role="alert" className="mt-3 text-sm">
          <p>Could not load these days. Check your connection and try again.</p>
          <button
            type="button"
            className="mt-2 text-xs font-medium underline"
            onClick={() => {
              setFailed("");
              setAttempt((current) => current + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">Loading these days…</p>
      ) : (
        <>
          {/* A key, not counts: the table above counts Together as the days
              you both trained, and a second "Together" figure here would be
              the sessions logged as Together, a different number. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {KEYS.map((athlete) => (
              <span key={athlete} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: ATHLETES[athlete].color }} />
                {ATHLETES[athlete].name}
              </span>
            ))}
            <span className="ml-auto tabular-nums">
              {plural(total, "session")} on {trained} of {plural(span, "day")}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {selected ? (
              <>
                {chosen.length ? (
                  <DayGroup day={selected} today={today} sessions={chosen} history={history} unit={unit} />
                ) : (
                  <p className="text-xs text-muted-foreground">No sessions on {longDay(selected)}.</p>
                )}
                <button
                  type="button"
                  className="text-xs font-medium underline"
                  onClick={() => setSelected(null)}
                >
                  {view === "week" ? "Show all 7 days" : "Clear day"}
                </button>
              </>
            ) : view === "month" ? (
              <p className="text-xs text-muted-foreground">Tap a day to see what was done.</p>
            ) : days.size ? (
              [...days].map(([day, sessions]) => (
                <DayGroup key={day} day={day} today={today} sessions={sessions} history={history} unit={unit} />
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No sessions in these 7 days.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
