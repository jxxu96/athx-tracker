"use client";

import { Kbd } from "@/components/ui/kbd";
import { chordLabel, useCommandKey } from "@/hooks/use-keyboard-shortcuts";

/**
 * Every key the app listens for. The header switch turns them on or off;
 * nothing here changes which key does what.
 *
 * Anywhere: who you are logging for, and which section opens.
 * Today: the energy card's day and timing, with a meal's keys for the
 * sittings. Session and Meal: that form's date, and in Meal the sitting. D is
 * today on a session, and dinner on a meal and on Today.
 * E with Command on a Mac, or Alt elsewhere, runs the estimator on either
 * form, and S saves it; both work from inside a field.
 */
const GROUPS = [
  {
    title: "Anywhere",
    items: [
      { key: "G", label: "Log for Gators" },
      { key: "H", label: "Log for Hippos" },
      { key: "V", label: "Log for both" },
      { key: "W", label: "Session" },
      { key: "M", label: "Meal" },
      { key: "T", label: "Today" },
      { key: "P", label: "Progress" },
    ],
  },
  {
    title: "Today",
    items: [
      { key: "B", label: "Energy at breakfast" },
      { key: "L", label: "Energy at lunch" },
      { key: "D", label: "Energy at dinner" },
      { key: "Y", label: "Energy for yesterday" },
    ],
  },
  {
    title: "Session",
    items: [
      { key: "D", label: "Date to today" },
      { key: "Y", label: "Date to yesterday" },
      { key: "E", command: true, label: "Fill workout with AI" },
      { key: "S", command: true, label: "Save session" },
    ],
  },
  {
    title: "Meal",
    items: [
      { key: "B", label: "Breakfast" },
      { key: "L", label: "Lunch" },
      { key: "D", label: "Dinner" },
      { key: "S", label: "Snack" },
      { key: "A", label: "Alcohol" },
      { key: "Y", label: "Date to yesterday" },
      { key: "E", command: true, label: "Estimate macros" },
      { key: "S", command: true, label: "Save meal" },
    ],
  },
] as const;

export function Keybinds() {
  const command = useCommandKey();
  return (
    <section aria-label="Keyboard shortcuts" className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          On a keyboard, while the switch in the header is on. A field or an open calendar takes the key,
          except {chordLabel(command, "e")} and {chordLabel(command, "s")}, which run the estimator and save from anywhere on
          the form.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group.title} className="space-y-1.5">
            <h4 className="text-xs font-semibold">{group.title}</h4>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={`${group.title}-${item.label}`} className="flex items-center justify-between gap-3 text-xs">
                  <span>{item.label}</span>
                  <Kbd className="bg-muted text-foreground">
                    {"command" in item ? chordLabel(command, item.key) : item.key}
                  </Kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
