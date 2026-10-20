"use client";

import { useCallback, useState } from "react";
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
import {
  ATHLETES,
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

export function Tracker({
  today,
  signOutPath,
  grokReady,
  records: initialRecords,
  settings: initialSettings,
  revision: initialRevision,
  loadError = "",
}: {
  today: string;
  signOutPath: string;
  grokReady: boolean;
  records: RecordItem[];
  settings: Settings;
  revision: number;
  loadError?: string;
}) {
  const [tab, setTab] = useState<Tab>("today");
  const [who, setWho] = useState<"hippos" | "gators">("hippos");
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  const [settings, setSettings] = useState(initialSettings);
  const [revision, setRevision] = useState(initialRevision);
  const [problem, setProblem] = useState(loadError);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [entries, config] = await Promise.all([
        api<{ records: RecordItem[] }>("/api/records"),
        api<{ settings: Settings; revision: number }>("/api/settings"),
      ]);
      setRecords(sortRecords(entries.records));
      setSettings(config.settings);
      setRevision(config.revision);
      setProblem("");
    } catch (error) {
      setProblem(message(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const save = useCallback(async (record: Workout | Meal) => {
    try {
      await api<{ record: RecordItem }>("/api/records", {
        method: "POST",
        body: JSON.stringify(record),
      });
      setRecords((current) =>
        sortRecords([record, ...current.filter((item) => item.id !== record.id)]),
      );
      toast.success(record.kind === "workout" ? "Session saved" : "Meal saved");
      setTab("today");
      window.scrollTo(0, 0);
    } catch (error) {
      toast.error(message(error));
      throw error;
    }
  }, []);

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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-semibold tracking-tight">
            Hippos &amp; Gators
          </h1>
          <div
            role="group"
            aria-label="Logging as"
            className="flex rounded-full bg-muted p-0.5"
          >
            {(["hippos", "gators"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setWho(key)}
                aria-pressed={who === key}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
                style={who === key ? { color: ATHLETES[key].color } : undefined}
              >
                {ATHLETES[key].name}
              </button>
            ))}
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
          <Overview records={records} settings={settings} today={today} />
        ) : tab === "session" ? (
          <WorkoutForm athlete={who} today={today} onSave={save} />
        ) : tab === "meal" ? (
          <MealForm
            athlete={who}
            today={today}
            grokReady={grokReady}
            onSave={save}
          />
        ) : tab === "log" ? (
          <History
            records={records}
            today={today}
            athlete="all"
            onDelete={remove}
          />
        ) : (
          <SettingsForm
            key={revision}
            settings={settings}
            grokReady={grokReady}
            signOutPath={signOutPath}
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
