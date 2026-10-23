"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  Dumbbell,
  RotateCw,
  Settings as SettingsIcon,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Overview } from "@/components/overview";
import { WorkoutForm } from "@/components/workout-form";
import { MealForm } from "@/components/meal-form";
import { History } from "@/components/history";
import { SettingsForm } from "@/components/settings-form";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ATHLETES,
  localDay,
  RECENT_LIMIT,
  type Meal,
  type RecordItem,
  type Settings,
  type Workout,
} from "@/lib/domain";
import { api, message, sortRecords } from "@/lib/client";

type Tab = "today" | "session" | "meal" | "log" | "settings";

const TABS = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "session", label: "Session", icon: Dumbbell },
  { id: "meal", label: "Meal", icon: UtensilsCrossed },
  { id: "log", label: "Log", icon: RotateCw },
  { id: "settings", label: "Setup", icon: SettingsIcon },
] as const satisfies readonly { id: Tab; label: string; icon: typeof Dumbbell }[];

/** Nothing to subscribe to: the device's day is read once, after hydration. */
const noSubscription = () => () => {};

export function Tracker({
  today: serverToday,
  grokReady,
  records: initialRecords,
  total: initialTotal,
  settings: initialSettings,
  revision: initialRevision,
  loadError = "",
}: {
  today: string;
  grokReady: boolean;
  records: RecordItem[];
  total: number;
  settings: Settings;
  revision: number;
  loadError?: string;
}) {
  // The server rendered with its own clock. Once this is running on the phone,
  // the phone's day is the one that counts.
  const today = useSyncExternalStore(
    noSubscription,
    () => localDay(),
    () => serverToday,
  );

  const [tab, setTab] = useState<Tab>("today");
  // One switch drives both forms: which columns the session shows, and whose
  // meal you are logging. "both" is the two-column session you asked for.
  const [who, setWho] = useState<"hippos" | "gators" | "both">("both");
  const sides = who === "both" ? (["hippos", "gators"] as const) : ([who] as const);
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  const [settings, setSettings] = useState(initialSettings);
  const [revision, setRevision] = useState(initialRevision);
  const [problem, setProblem] = useState(loadError);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // How many entries exist, against how many are in hand. The app opens with a
  // recent slice; the Log offers the rest rather than making every load pay for
  // years of history nothing on the first screen reads.
  const [total, setTotal] = useState(initialTotal);
  const [scope, setScope] = useState<"recent" | "all">("recent");

  const reload = useCallback(async (next: "recent" | "all") => {
    setRefreshing(true);
    try {
      const [entries, config] = await Promise.all([
        api<{ records: RecordItem[]; total: number }>(
          next === "all" ? "/api/records" : `/api/records?limit=${RECENT_LIMIT}`,
        ),
        api<{ settings: Settings; revision: number }>("/api/settings"),
      ]);
      setRecords(sortRecords(entries.records));
      setTotal(entries.total);
      setScope(next);
      setSettings(config.settings);
      setRevision(config.revision);
      setProblem("");
    } catch (error) {
      setProblem(message(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refreshing keeps whatever the Log is already showing: having asked for the
  // whole journal once, it should not silently shrink back on the next tap.
  const refresh = useCallback(() => reload(scope), [reload, scope]);
  const loadAll = useCallback(() => reload("all"), [reload]);

  /**
   * A submit, not a record. Logging for both used to save one athlete, succeed,
   * and navigate away mid-flight, unmounting the form and taking the other
   * athlete's unsaved session with it. Nothing moves until all of them are in.
   */
  const keep = useCallback((batch: RecordItem[]) => {
    setRecords((current) =>
      sortRecords([
        ...batch,
        ...current.filter((item) => !batch.some((r) => r.id === item.id)),
      ]),
    );
  }, []);

  const save = useCallback(
    async (batch: (Workout | Meal)[]) => {
      const stored: RecordItem[] = [];
      try {
        // Sequential: the second must not race the first through SQLite.
        for (const record of batch) {
          await api<{ record: RecordItem }>("/api/records", {
            method: "POST",
            body: JSON.stringify(record),
          });
          stored.push(record);
        }
      } catch (error) {
        // Whatever did land is kept on screen, so a retry shows what is left.
        if (stored.length) keep(stored);
        toast.error(message(error));
        throw error;
      }

      keep(stored);
      toast.success(
        editing
          ? "Entry updated"
          : batch[0]?.kind === "workout"
            ? batch.length > 1
              ? "Sessions saved"
              : "Session saved"
            : "Meal saved",
      );
      setEditing(null);
      setTab("today");
      window.scrollTo(0, 0);
    },
    [editing, keep],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await api<{ ok: true }>("/api/records", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setRecords((current) => current.filter((item) => item.id !== id));
      toast.success("Entry deleted");
    } catch (error) {
      toast.error(message(error));
      throw error;
    }
  }, []);

  const saveSettings = useCallback(
    async (next: Settings) => {
      try {
        const saved = await api<{ settings: Settings; revision: number }>(
          "/api/settings",
          { method: "PUT", body: JSON.stringify({ settings: next, revision }) },
        );
        setSettings(saved.settings);
        setRevision(saved.revision);
        toast.success("Settings saved");
      } catch (error) {
        toast.error(message(error));
        // Someone saved from the other phone: pull their version back in.
        if ((error as Error & { status?: number }).status === 409) await refresh();
        throw error;
      }
    },
    [revision, refresh],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <Toaster position="top-center" />

      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          {/* Three theme buttons and a refresh leave no room for this beside
              the athlete pills on a phone, and the name is already on the tab
              and the home screen icon. */}
          <h1 className="hidden truncate text-sm font-semibold tracking-tight sm:block">
            Hippos &amp; Gators
          </h1>
          <div className="flex shrink-0 items-center gap-1">
          <div
            role="group"
            aria-label="Logging for"
            className="flex rounded-full bg-muted p-0.5"
          >
            {(["hippos", "gators", "both"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setWho(key)}
                aria-pressed={who === key}
                className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
                style={
                  who === key && key !== "both"
                    ? { color: ATHLETES[key].ink }
                    : undefined
                }
              >
                {key === "both" ? "Both" : ATHLETES[key].name}
              </button>
            ))}
          </div>
          {/* Two people on two phones: one logs, the other wants it without
              hunting for the browser's own reload. */}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh from the server"
            title="Refresh from the server"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RotateCw className={`size-4${refreshing ? " animate-spin" : ""}`} />
          </button>
          <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {problem ? (
          <div className="rounded-2xl border bg-card p-6 text-center">
            <p className="text-sm font-medium">{problem}</p>
            <Button
              className="mt-4"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Trying…" : "Try again"}
            </Button>
          </div>
        ) : tab === "today" ? (
          <Overview
            records={records}
            settings={settings}
            today={today}
            journalTotal={total}
            loadingAll={refreshing}
            onLoadAll={scope === "all" || records.length >= total ? undefined : loadAll}
          />
        ) : tab === "session" ? (
          <WorkoutForm
            key={editing?.id ?? "new-session"}
            today={today}
            sides={sides}
            weightUnit={settings.weightUnit ?? "lb"}
            editing={editing?.kind === "workout" ? editing : null}
            onCancelEdit={() => setEditing(null)}
            onSave={save}
          />
        ) : tab === "meal" ? (
          <MealForm
            key={editing?.id ?? "new-meal"}
            athlete={
              editing?.kind === "meal"
                ? editing.athlete
                : who === "both"
                  ? "hippos"
                  : who
            }
            today={today}
            grokReady={grokReady}
            editing={editing?.kind === "meal" ? editing : null}
            onAthlete={setWho}
            onCancelEdit={() => setEditing(null)}
            onSave={save}
          />
        ) : tab === "log" ? (
          <History
            records={records}
            today={today}
            athlete="all"
            weightUnit={settings.weightUnit ?? "lb"}
            bodyweight={settings.bodyweight ?? { hippos: 0, gators: 0 }}
            total={total}
            loadingAll={refreshing}
            onLoadAll={scope === "all" ? undefined : loadAll}
            onEdit={(record) => {
              setEditing(record);
              setTab(record.kind === "workout" ? "session" : "meal");
              window.scrollTo(0, 0);
            }}
            onDelete={remove}
          />
        ) : (
          <SettingsForm
            key={revision}
            settings={settings}
            grokReady={grokReady}
            onRefresh={refresh}
            onSave={saveSettings}
          />
        )}
      </main>

      <nav
        aria-label="Sections"
        className="sticky bottom-0 z-20 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              window.scrollTo(0, 0);
            }}
            aria-current={tab === id ? "page" : undefined}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors aria-[current]:text-foreground"
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
