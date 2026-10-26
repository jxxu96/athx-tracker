"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  Dumbbell,
  RotateCw,
  Settings as SettingsIcon,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Overview } from "@/components/overview";
import { WorkoutForm } from "@/components/workout-form";
import { MealForm } from "@/components/meal-form";
import { History } from "@/components/history";
import { Progress } from "@/components/progress";
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
import { athleteOutline } from "@/lib/athlete-outline";
import { api, isMeal, message, sortRecords } from "@/lib/client";

type Tab = "today" | "session" | "meal" | "progress" | "log" | "settings";

const TABS = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "session", label: "Session", icon: Dumbbell },
  { id: "meal", label: "Meal", icon: UtensilsCrossed },
  { id: "progress", label: "Progress", icon: TrendingUp },
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
  // Zero means unopened; advancing a form's key starts a fresh draft after save.
  const [formKeys, setFormKeys] = useState({ meal: 0, session: 0 });
  const activeTab = useRef(tab);
  const navigate = useCallback((next: Tab) => {
    activeTab.current = next;
    setTab(next);
    if (next === "meal" || next === "session") {
      setFormKeys((current) => ({ ...current, [next]: current[next] || 1 }));
      toast.dismiss(`${next}-estimate`);
    }
    window.scrollTo(0, 0);
  }, []);
  const estimateFinished = useCallback((section: "meal" | "session", error?: string) => {
    if (activeTab.current === section) return;
    const label = section === "meal" ? "Meal" : "Session";
    const options = {
      id: `${section}-estimate`,
      description: error ?? "Review the filled fields before saving.",
      duration: Infinity,
      closeButton: true,
      action: { label: `View ${section}`, onClick: () => navigate(section) },
    };
    if (error) toast.error(`${label} estimate failed`, options);
    else toast.success(`${label} estimate ready`, options);
  }, [navigate]);
  // One switch drives both forms: which columns the session shows, and who a
  // new meal is saved for. The journal opens on Hippos. "both" writes both athletes.
  const [who, setWho] = useState<"hippos" | "gators" | "both">("hippos");
  const sides = who === "both" ? (["hippos", "gators"] as const) : ([who] as const);
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  const [settings, setSettings] = useState(initialSettings);
  const [revision, setRevision] = useState(initialRevision);
  const [problem, setProblem] = useState(loadError);
  // Editing one kind must not remount the other kind's background estimate.
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
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
        batch.some((record) => record.id === editingMeal?.id || record.id === editingWorkout?.id)
          ? "Entry updated"
          : batch[0]?.kind === "workout"
            ? batch.length > 1
              ? "Sessions saved"
              : "Session saved"
            : batch.length > 1
              ? `Meals saved for ${batch.map((item) => ATHLETES[item.athlete].name).join(" and ")}`
              : "Meal saved",
      );
      if (batch[0]?.kind === "meal") setEditingMeal(null);
      else setEditingWorkout(null);
      const section = batch[0]?.kind === "meal" ? "meal" : "session";
      setFormKeys((current) => ({ ...current, [section]: current[section] + 1 }));
      navigate("today");
    },
    [editingMeal, editingWorkout, keep, navigate],
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
    async (next: Settings, notice = "Settings saved") => {
      try {
        const saved = await api<{ settings: Settings; revision: number }>(
          "/api/settings",
          { method: "PUT", body: JSON.stringify({ settings: next, revision }) },
        );
        setSettings(saved.settings);
        setRevision(saved.revision);
        toast.success(notice);
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
      <Toaster position="top-center" expand />

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
                {...(who === key ? athleteOutline(key, "background") : {})}
                className="rounded-full border-2 border-transparent px-2 py-0.5 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
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
        ) : tab === "progress" ? (
          <Progress
            records={records}
            settings={settings}
            today={today}
            journalTotal={total}
            loadingAll={refreshing}
            onLoadAll={scope === "all" || records.length >= total ? undefined : loadAll}
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
              if (record.kind === "workout") setEditingWorkout(record);
              else setEditingMeal(record);
              navigate(record.kind === "workout" ? "session" : "meal");
            }}
            onDelete={remove}
          />
        ) : tab === "settings" ? (
          <SettingsForm
            key={revision}
            settings={settings}
            grokReady={grokReady}
            onRefresh={refresh}
            onSave={saveSettings}
          />
        ) : null}
        {/* Keep visited forms mounted: hiding a section must not cancel its
            request or discard its draft, even if a refresh reports an error. */}
        <div hidden={Boolean(problem) || tab !== "session"}>
        {formKeys.session > 0 ? (
          <WorkoutForm
            key={editingWorkout?.id ?? `new-session-${formKeys.session}`}
            today={today}
            grokReady={grokReady}
            sides={sides}
            onLoggingFor={setWho}
            weightUnit={settings.weightUnit ?? "lb"}
            onWeightUnit={(weightUnit) =>
              // The form already reads its boxes in the new unit; this only
              // remembers the choice. A failure has said so in a toast.
              void saveSettings(
                { ...settings, weightUnit },
                `Weights now in ${weightUnit}`,
              ).catch(() => {})
            }
            active={tab === "session" && !problem}
            editing={editingWorkout}
            onCancelEdit={() => setEditingWorkout(null)}
            onEstimateComplete={(error) => estimateFinished("session", error)}
            onSave={save}
          />
        ) : null}
        </div>
        <div hidden={Boolean(problem) || tab !== "meal"}>
        {formKeys.meal > 0 ? (
          <MealForm
            key={editingMeal?.id ?? `new-meal-${formKeys.meal}`}
            loggingFor={editingMeal?.athlete ?? who}
            meals={records.filter(isMeal)}
            today={today}
            grokReady={grokReady}
            active={tab === "meal" && !problem}
            editing={editingMeal}
            onLoggingFor={setWho}
            onCancelEdit={() => setEditingMeal(null)}
            onEstimateComplete={(error) => estimateFinished("meal", error)}
            onSave={save}
          />
        ) : null}
        </div>
      </main>

      <nav
        aria-label="Sections"
        className="sticky bottom-0 z-20 grid grid-cols-6 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
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
