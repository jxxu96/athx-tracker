import { dayToDate, daysBetween } from "@/lib/client";

/**
 * The days left to the event, small enough for the header: "295 d". It used
 * to be a box of its own at the top of Today, a third of the first screen
 * for one number. Read aloud, it says what the number is counting to.
 */
export function Countdown({
  eventName,
  eventDate,
  today,
}: {
  eventName: string;
  eventDate: string;
  today: string;
}) {
  const left = Math.max(0, daysBetween(today, eventDate));
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayToDate(eventDate));
  return (
    <p
      title={`${eventName} · ${date}`}
      className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums"
    >
      <span aria-hidden="true">{left} d</span>
      <span className="sr-only">
        {left} {left === 1 ? "day" : "days"} to {eventName}, {date}
      </span>
    </p>
  );
}
