import { Kbd } from "@/components/ui/kbd";

/**
 * Every key the app listens for. The header switch turns them on or off;
 * nothing here changes which key does what.
 *
 * Anywhere: who you are logging for, and which section opens.
 * Today: the energy card's day. Session and Meal: that form's date, and in
 * Meal the sitting. D is today on a session and dinner on a meal.
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
    items: [{ key: "Y", label: "Energy for yesterday" }],
  },
  {
    title: "Session",
    items: [
      { key: "D", label: "Date to today" },
      { key: "Y", label: "Date to yesterday" },
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
    ],
  },
] as const;

export function Keybinds() {
  return (
    <section aria-label="Keyboard shortcuts" className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          On a keyboard, while the switch in the header is on. A field or an open calendar takes the key.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="space-y-1.5">
            <h4 className="text-xs font-semibold">{group.title}</h4>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={`${group.title}-${item.key}`} className="flex items-center justify-between gap-3 text-xs">
                  <span>{item.label}</span>
                  <Kbd className="bg-muted text-foreground">{item.key}</Kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
