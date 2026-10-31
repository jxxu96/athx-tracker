"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  CloudOff,
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
import { DraftBoundary } from "@/components/draft-boundary";
import { Drafts } from "@/components/drafts";
import {
  ATHLETES,
  localDay,
  RECENT_LIMIT,
  type Bodyweight,
  type Meal,
  type RecordItem,
  type Settings,
  type Workout,
} from "@/lib/domain";
import { athleteOutline } from "@/lib/athlete-outline";
import { bodyweightHistory } from "@/lib/bodyweight";
import { bestLine, type NewBest } from "@/lib/bests";
import { api, isMeal, message, sortRecords } from "@/lib/client";
import {
  applyOutbox,
  changeOutbox,
  enqueueDelete,
  enqueueSave,
  outboxSnapshot,
  refuse,
  retryable,
  serverOutbox,
  settle,
  subscribeOutbox,
} from "@/lib/outbox";
import { journalSummary, type JournalSummary } from "@/lib/summary";
import { heldFrom as sliceHeldFrom } from "@/lib/session-calendar";
import {
  changeDrafts,
  draftFor,
  draftsSnapshot,
  dropDraft,
  dropDraftsFor,
  openDraft,
  openedDraft,
  type Draft,
  type DraftKind,
} from "@/lib/drafts";

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

/**
 * How long a save may hang on a poor connection before it waits on the phone
 * instead. The server may have it after all; sending it again is harmless.
 */
const SAVE_TIMEOUT_MS = 15_000;
/** Coming back to the app catches up at most this often. */
const CATCH_UP_MS = 30_000;
/** While something waits to be sent, it is tried again this often as well. */
const RESEND_MS = 60_000;

const timeout = (ms: number) =>
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;

function postRecord(record: RecordItem) {
  return api<{ record: RecordItem; newBests?: NewBest[] }>("/api/records", {
    method: "POST",
    body: JSON.stringify(record),
    signal: timeout(SAVE_TIMEOUT_MS),
  });
}

function deleteRecord(id: string) {
  return api<{ ok: true }>("/api/records", {
    method: "DELETE",
    body: JSON.stringify({ id }),
    signal: timeout(SAVE_TIMEOUT_MS),
  });
}

/** Why something is waiting, in words: no answer, or a sign-in that lapsed. */
function waitingReason(error: unknown) {
  return (error as { status?: number }).status === 401
    ? "You are signed out on this phone. Sign in again and it sends itself."
    : "The server could not be reached. It stays on this phone and sends itself when the server answers.";
}

export function Tracker({
  today: serverToday,
  grokReady,
  records: initialRecords,
  total: initialTotal,
  settings: initialSettings,
  revision: initialRevision,
  summary: initialSummary = null,
  build = "unknown",
  loadError = "",
}: {
  today: string;
  grokReady: boolean;
  records: RecordItem[];
  total: number;
  settings: Settings;
  revision: number;
  summary?: JournalSummary | null;
  build?: string;
  loadError?: string;
}) {
  // The server rendered with its own clock. Once this is running on the phone,
  // the phone's day is the one that counts.
  const today = useSyncExternalStore(
    noSubscription,
    () => localDay(),
    () => serverToday,
  );
  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const [tab, setTab] = useState<Tab>("today");
  // Zero means unopened; advancing a form's key starts a fresh draft after save.
  const [formKeys, setFormKeys] = useState({ meal: 0, session: 0 });
  const activeTab = useRef(tab);
  // One switch drives both forms: which columns the session shows, and who a
  // new meal is saved for. The journal opens on Hippos. "both" writes both athletes.
  const [who, setWho] = useState<"hippos" | "gators" | "both">("hippos");
  // Editing one kind must not remount the other kind's background estimate.
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  // The draft each form opened with, when it opened with one.
  const [mealDraft, setMealDraft] = useState<Draft | null>(null);
  const [sessionDraft, setSessionDraft] = useState<Draft | null>(null);
  const formOpened = useRef({ meal: false, session: false });

  /** Opens a draft on its form, as it was left: an edit as that edit. */
  const openDraftOnForm = useCallback((draft: Draft) => {
    changeDrafts((book) => openDraft(book, draft.kind, draft.id));
    if (draft.kind === "meal") {
      setEditingMeal(draft.editing as Meal | null);
      setMealDraft(draft);
    } else {
      setEditingWorkout(draft.editing as Workout | null);
      setSessionDraft(draft);
    }
    if (!draft.editing) setWho(draft.who);
  }, []);

  const navigate = useCallback((next: Tab) => {
    activeTab.current = next;
    setTab(next);
    if (next === "meal" || next === "session") {
      // The first time a form opens, it opens on whatever was left typed in
      // it, so closing the app mid-meal loses nothing.
      if (!formOpened.current[next]) {
        formOpened.current[next] = true;
        const left = openedDraft(draftsSnapshot(), next);
        if (left) openDraftOnForm(left);
      }
      setFormKeys((current) => ({ ...current, [next]: current[next] || 1 }));
      toast.dismiss(`${next}-estimate`);
    }
    window.scrollTo(0, 0);
  }, [openDraftOnForm]);

  /** An entry from the Log, picking up any unsaved edit of it. */
  const openEdit = useCallback((record: Meal | Workout) => {
    const kind: DraftKind = record.kind === "meal" ? "meal" : "session";
    formOpened.current[kind] = true;
    const left = draftFor(draftsSnapshot(), record.id);
    if (left) openDraftOnForm(left);
    else {
      // Whatever draft the form had open is set aside for the edit, so it is
      // listed in Drafts rather than hidden as if it were still on the form.
      changeDrafts((book) => openDraft(book, kind, null));
      if (record.kind === "meal") {
        setEditingMeal(record);
        setMealDraft(null);
      } else {
        setEditingWorkout(record);
        setSessionDraft(null);
      }
    }
    navigate(kind);
  }, [navigate, openDraftOnForm]);

  /** A fresh form; whatever was on it stays in Drafts unless it was discarded. */
  const startNew = useCallback((kind: DraftKind) => {
    changeDrafts((book) => openDraft(book, kind, null));
    if (kind === "meal") {
      setEditingMeal(null);
      setMealDraft(null);
    } else {
      setEditingWorkout(null);
      setSessionDraft(null);
    }
    setFormKeys((current) => ({ ...current, [kind]: current[kind] + 1 }));
    window.scrollTo(0, 0);
  }, []);

  /** A draft the form could not draw is set aside, so it cannot fail again. */
  const draftFailed = useCallback((draft: Draft | null) => {
    if (!draft) return;
    changeDrafts((book) => dropDraft(book, draft.id));
    toast.error("A draft could not be opened, so it was removed.");
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
  const sides = who === "both" ? (["hippos", "gators"] as const) : ([who] as const);
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  const [settings, setSettings] = useState(initialSettings);
  const [revision, setRevision] = useState(initialRevision);
  const [problem, setProblem] = useState(loadError);
  const [refreshing, setRefreshing] = useState(false);
  // How many entries exist, against how many are in hand. The app opens with a
  // recent slice; the Log offers the rest rather than making every load pay for
  // years of history nothing on the first screen reads.
  const [total, setTotal] = useState(initialTotal);
  const [scope, setScope] = useState<"recent" | "all">("recent");
  // Whether what is in hand is the whole journal, as of the last fetch. Saving
  // here adds to both, so it stays true or false until the next one.
  const [complete, setComplete] = useState(initialRecords.length >= initialTotal);
  // The oldest day that slice reaches. Days fetched on their own later do not
  // move it, since the days between them and the slice are still missing.
  const [heldFrom, setHeldFrom] = useState(() =>
    sliceHeldFrom(initialRecords, initialRecords.length >= initialTotal),
  );
  // The whole-journal figures the server worked out, for while only the
  // recent slice is in hand.
  const [summary, setSummary] = useState(initialSummary);
  const [fuelRefresh, setFuelRefresh] = useState(0);
  const unit = settings.weightUnit ?? "lb";

  /** What this phone has not sent yet, shown as if it had been. */
  const outbox = useSyncExternalStore(subscribeOutbox, outboxSnapshot, serverOutbox);
  const shown = useMemo(() => sortRecords(applyOutbox(records, outbox)), [records, outbox]);
  // Leaving Setup with edits in it discards them, but a refresh while it is
  // open must not: the form is keyed on the settings revision.
  const setupDirty = useRef(false);
  const markSetupDirty = useCallback((dirty: boolean) => {
    setupDirty.current = dirty;
  }, []);
  const lastFetch = useRef(0);

  const announceBests = useCallback((bests: NewBest[]) => {
    if (!bests.length) return;
    const named = new Set(bests.map((best) => best.athlete)).size > 1;
    toast.success(bests.length > 1 ? "New bests" : "New best", {
      description: (
        <>
          {bests.map((best) => (
            <span key={`${best.athlete}-${best.name}`} className="block">
              {named ? `${ATHLETES[best.athlete].name}: ` : ""}
              {bestLine(best, unit)}
            </span>
          ))}
        </>
      ),
      duration: 10_000,
    });
  }, [unit]);

  const refreshSummary = useCallback(async () => {
    try {
      const { summary: next } = await api<{ summary: JournalSummary }>(
        `/api/summary?today=${todayRef.current}`,
      );
      setSummary(next);
    } catch {
      // The figures on screen stay until the next refresh answers.
    }
  }, []);

  /**
   * Fetches the journal again. A failure on a phone already showing it is a
   * notice, not a screen in the way: the app works without a connection now,
   * and the forms must stay reachable. quiet is a refresh nobody asked for.
   */
  const reload = useCallback(async (
    next: "recent" | "all",
    { quiet = false, keepSettings = false } = {},
  ) => {
    setRefreshing(true);
    try {
      const [entries, config, figures] = await Promise.all([
        api<{ records: RecordItem[]; total: number }>(
          next === "all" ? "/api/records" : `/api/records?limit=${RECENT_LIMIT}`,
        ),
        keepSettings ? null : api<{ settings: Settings; revision: number }>("/api/settings"),
        api<{ summary: JournalSummary }>(`/api/summary?today=${todayRef.current}`),
      ]);
      setRecords(sortRecords(entries.records));
      setTotal(entries.total);
      setComplete(entries.records.length >= entries.total);
      setHeldFrom(sliceHeldFrom(entries.records, entries.records.length >= entries.total));
      setScope(next);
      if (config) {
        setSettings(config.settings);
        setRevision(config.revision);
      }
      setSummary(figures.summary);
      setFuelRefresh((current) => current + 1);
      setProblem("");
      lastFetch.current = Date.now();
    } catch (error) {
      if (problem) setProblem(message(error));
      else if (!quiet)
        toast.error(
          (error as { status?: number }).status === undefined
            ? "No connection. This phone is showing what it already has."
            : message(error),
        );
    } finally {
      setRefreshing(false);
    }
  }, [problem]);

  // Refreshing keeps whatever the Log is already showing: having asked for the
  // whole journal once, it should not silently shrink back on the next tap.
  const refresh = useCallback(() => reload(scope), [reload, scope]);
  const loadAll = useCallback(() => reload("all"), [reload]);

  const loadFuelDay = useCallback(async (day: string) => {
    if (complete) return;
    const { records: entries } = await api<{ records: RecordItem[] }>(
      `/api/records?day=${day}`,
      { signal: timeout(SAVE_TIMEOUT_MS) },
    );
    // Pending edits and deletes are still applied by the outbox over this copy.
    setRecords((current) => sortRecords([
      ...current.filter((record) => record.day !== day),
      ...entries,
    ]));
  }, [complete]);

  /** A calendar's sessions from before the slice, merged in like a picked day's. */
  const loadSessions = useCallback(async (from: string, to: string) => {
    const { records: entries } = await api<{ records: RecordItem[] }>(
      `/api/records?from=${from}&to=${to}&kind=workout`,
      { signal: timeout(SAVE_TIMEOUT_MS) },
    );
    setRecords((current) => sortRecords([
      ...current.filter((record) => record.kind !== "workout" || record.day < from || record.day > to),
      ...entries,
    ]));
  }, []);

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

  /**
   * Sends records in order. When the server cannot be reached, that record
   * and the ones after it wait on the phone and the save still goes through;
   * a refusal, which waiting would not cure, is thrown for the form to show.
   */
  const persist = useCallback(async (batch: RecordItem[]) => {
    const stored: RecordItem[] = [];
    const bests: NewBest[] = [];
    let reason = "";
    for (const record of batch) {
      if (!reason) {
        try {
          // Sequential: the second must not race the first through SQLite.
          const saved = await postRecord(record);
          bests.push(...(saved.newBests ?? []));
          stored.push(record);
          // An older version may still be waiting; the server has a newer one now.
          if (outboxSnapshot().some((entry) => entry.op === "save" && entry.record.id === record.id))
            changeOutbox((entries) => entries.filter((entry) => entry.op !== "save" || entry.record.id !== record.id));
          continue;
        } catch (error) {
          if (!retryable(error)) {
            // Whatever did land is kept on screen, so a retry shows what is left.
            if (stored.length) keep(stored);
            throw error;
          }
          reason = waitingReason(error);
        }
      }
      changeOutbox((entries) => enqueueSave(entries, record));
      stored.push(record);
    }
    keep(stored);
    return { reason, bests };
  }, [keep]);

  const save = useCallback(
    async (batch: (Workout | Meal)[]) => {
      let result: Awaited<ReturnType<typeof persist>>;
      try {
        result = await persist(batch);
      } catch (error) {
        toast.error(message(error));
        throw error;
      }

      const label = batch.some((record) => record.id === editingMeal?.id || record.id === editingWorkout?.id)
        ? "Entry updated"
        : batch[0]?.kind === "workout"
          ? batch.length > 1
            ? "Sessions saved"
            : "Session saved"
          : batch.length > 1
            ? `Meals saved for ${batch.map((item) => ATHLETES[item.athlete].name).join(" and ")}`
            : "Meal saved";
      if (result.reason) toast("Saved on this phone", { description: result.reason, icon: <CloudOff className="size-4" /> });
      else toast.success(label);
      announceBests(result.bests);
      if (batch[0]?.kind === "meal") {
        setEditingMeal(null);
        setMealDraft(null);
      } else {
        setEditingWorkout(null);
        setSessionDraft(null);
      }
      const section = batch[0]?.kind === "meal" ? "meal" : "session";
      setFormKeys((current) => ({ ...current, [section]: current[section] + 1 }));
      navigate("today");
      if (!result.reason) void refreshSummary();
    },
    [announceBests, editingMeal, editingWorkout, navigate, persist, refreshSummary],
  );

  /** A weigh-in edited in the Log: saved where it stands, without leaving it. */
  const update = useCallback(async (record: Bodyweight) => {
    try {
      const result = await persist([record]);
      if (result.reason) toast("Saved on this phone", { description: result.reason, icon: <CloudOff className="size-4" /> });
      else {
        toast.success("Entry updated");
        void refreshSummary();
      }
    } catch (error) {
      toast.error(message(error));
      throw error;
    }
  }, [persist, refreshSummary]);

  const remove = useCallback(async (id: string) => {
    try {
      // Whether or not the server ever had it, deleting it there is harmless.
      await deleteRecord(id);
      changeOutbox((entries) =>
        entries.filter((entry) => (entry.op === "save" ? entry.record.id : entry.id) !== id),
      );
      toast.success("Entry deleted");
      void refreshSummary();
    } catch (error) {
      if (!retryable(error)) {
        toast.error(message(error));
        throw error;
      }
      changeOutbox((entries) => enqueueDelete(entries, id));
      toast("Deleted on this phone", { description: waitingReason(error), icon: <CloudOff className="size-4" /> });
    }
    // An unsaved edit of it would bring it back if it were ever saved.
    changeDrafts((book) => dropDraftsFor(book, id));
    setRecords((current) => current.filter((item) => item.id !== id));
  }, [refreshSummary]);

  /**
   * Sends what is waiting, oldest first. It stops at the first that still
   * gets no answer, since the rest would fare the same, and sets aside one
   * the server refuses, to wait for an edit or a delete rather than be
   * retried forever.
   */
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current || !outboxSnapshot().some((entry) => !entry.error)) return 0;
    flushing.current = true;
    let sent = 0;
    const bests: NewBest[] = [];
    try {
      for (const entry of [...outboxSnapshot()]) {
        if (entry.error) continue;
        try {
          if (entry.op === "save") bests.push(...((await postRecord(entry.record)).newBests ?? []));
          else await deleteRecord(entry.id);
          changeOutbox((entries) => settle(entries, entry.seq));
          sent += 1;
        } catch (error) {
          if (retryable(error)) break;
          changeOutbox((entries) => refuse(entries, entry.seq, message(error)));
        }
      }
    } finally {
      flushing.current = false;
    }
    if (sent) {
      toast.success(sent === 1 ? "A waiting entry was sent" : `${sent} waiting entries were sent`);
      announceBests(bests);
    }
    return sent;
  }, [announceBests]);

  /** Back to the app, or back online: send what waits, then fetch what the other phone logged. */
  const catchUp = useCallback(async (force = false) => {
    await flush();
    if (!force && Date.now() - lastFetch.current < CATCH_UP_MS) return;
    await reload(scope, { quiet: true, keepSettings: setupDirty.current });
  }, [flush, reload, scope]);

  // Whatever was waiting when the app last closed is on screen already; send it.
  useEffect(() => {
    lastFetch.current = Date.now();
    if (outboxSnapshot().length) void flush().then((sent) => (sent ? refresh() : undefined));
    // Mount only: what arrives later is handled by the listeners below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    const online = () => void catchUp(true);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", online);
    const timer = window.setInterval(() => {
      if (outboxSnapshot().some((entry) => !entry.error)) void catchUp();
    }, RESEND_MS);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", online);
      window.clearInterval(timer);
    };
  }, [catchUp]);

  // The app opens without a connection once it has been opened with one. The
  // files this visit loaded before the worker ran are handed to it to keep.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(build)}`)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.includes("/_next/static/"));
        registration.active?.postMessage({ type: "keep", urls: ["/", ...urls] });
      })
      .catch(() => {});
  }, [build]);

  // A day that has turned since the figures were worked out has a new week.
  useEffect(() => {
    if (summary && summary.today !== today && !complete) void refreshSummary();
  }, [complete, refreshSummary, summary, today]);

  const saveSettings = useCallback(
    async (next: Settings, notice = "Settings saved", weighIns: Bodyweight[] = []) => {
      try {
        // Weigh-ins are journal entries, so they wait on the phone like any other.
        const logged = weighIns.length ? await persist(weighIns) : null;
        const saved = await api<{ settings: Settings; revision: number }>(
          "/api/settings",
          { method: "PUT", body: JSON.stringify({ settings: next, revision }) },
        );
        setupDirty.current = false;
        setSettings(saved.settings);
        setRevision(saved.revision);
        toast.success(notice);
        if (logged?.reason)
          toast("Weigh-in saved on this phone", { description: logged.reason, icon: <CloudOff className="size-4" /> });
        void refreshSummary();
      } catch (error) {
        toast.error(message(error));
        // Someone saved from the other phone: pull their version back in.
        if ((error as Error & { status?: number }).status === 409) await refresh();
        throw error;
      }
    },
    [persist, revision, refresh, refreshSummary],
  );

  const history = useMemo(
    () => bodyweightHistory(shown, settings.bodyweight),
    [shown, settings.bodyweight],
  );
  // The phone's own figures when it holds the whole journal, so what it saved
  // shows at once and without a connection; the server's while it does not.
  const figures = useMemo(
    () => (complete || !summary ? journalSummary(shown, settings, today) : summary),
    [complete, shown, settings, summary, today],
  );
  const waiting = outbox.length;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <Toaster position="top-center" expand />

      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          {/* Theme buttons and a refresh leave no room for this beside the
              athlete pills on a phone, and the name is already on the tab and
              the home screen icon. */}
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
          {waiting ? (
            <button
              type="button"
              onClick={() => void catchUp(true)}
              aria-label={`${waiting} waiting to send. Send now`}
              title="Waiting to send"
              className="flex items-center gap-1 rounded-full px-1.5 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CloudOff className="size-4" />
              {waiting}
            </button>
          ) : null}
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
            records={shown}
            settings={settings}
            history={history}
            figures={figures}
            today={today}
            onLoadFuelDay={loadFuelDay}
            fuelRefresh={fuelRefresh}
            heldFrom={heldFrom}
            onLoadSessions={loadSessions}
          />
        ) : tab === "progress" ? (
          <Progress
            records={shown}
            settings={settings}
            history={history}
            figures={figures}
            today={today}
            journalTotal={total}
            loadingAll={refreshing}
            onLoadAll={scope === "all" || shown.length >= total ? undefined : loadAll}
          />
        ) : tab === "log" ? (
          <History
            records={shown}
            today={today}
            athlete="all"
            weightUnit={unit}
            history={history}
            outbox={outbox}
            total={total}
            loadingAll={refreshing}
            onLoadAll={scope === "all" ? undefined : loadAll}
            onSendNow={() => void catchUp(true)}
            onEdit={(record) => {
              if (record.kind !== "bodyweight") openEdit(record);
            }}
            onUpdate={update}
            onDelete={remove}
          />
        ) : tab === "settings" ? (
          <SettingsForm
            key={revision}
            settings={settings}
            history={history}
            today={today}
            grokReady={grokReady}
            onRefresh={refresh}
            onSave={saveSettings}
            onDirty={markSetupDirty}
          />
        ) : null}
        {/* Keep visited forms mounted: hiding a section must not cancel its
            request or discard its draft, even if a refresh reports an error. */}
        <div hidden={Boolean(problem) || tab !== "session"}>
        {formKeys.session > 0 ? <Drafts kind="session" today={today} onOpen={openDraftOnForm} /> : null}
        {formKeys.session > 0 ? (
          <DraftBoundary
            key={sessionDraft ? `draft-${sessionDraft.id}` : editingWorkout?.id ?? `new-session-${formKeys.session}`}
            onError={() => draftFailed(sessionDraft)}
            onReset={() => startNew("session")}
          >
          <WorkoutForm
            today={today}
            grokReady={grokReady}
            sides={sides}
            onLoggingFor={setWho}
            weightUnit={unit}
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
            draft={sessionDraft}
            onCancelEdit={() => {
              setEditingWorkout(null);
              setSessionDraft(null);
            }}
            onStartNew={() => startNew("session")}
            onEstimateComplete={(error) => estimateFinished("session", error)}
            onSave={save}
          />
          </DraftBoundary>
        ) : null}
        </div>
        <div hidden={Boolean(problem) || tab !== "meal"}>
        {formKeys.meal > 0 ? <Drafts kind="meal" today={today} onOpen={openDraftOnForm} /> : null}
        {formKeys.meal > 0 ? (
          <DraftBoundary
            key={mealDraft ? `draft-${mealDraft.id}` : editingMeal?.id ?? `new-meal-${formKeys.meal}`}
            onError={() => draftFailed(mealDraft)}
            onReset={() => startNew("meal")}
          >
          <MealForm
            loggingFor={editingMeal?.athlete ?? who}
            meals={shown.filter(isMeal)}
            templates={settings.mealTemplates}
            today={today}
            grokReady={grokReady}
            active={tab === "meal" && !problem}
            editing={editingMeal}
            draft={mealDraft}
            onLoggingFor={setWho}
            onCancelEdit={() => {
              setEditingMeal(null);
              setMealDraft(null);
            }}
            onStartNew={() => startNew("meal")}
            onEstimateComplete={(error) => estimateFinished("meal", error)}
            onSave={save}
            onSaveTemplates={(mealTemplates, notice) =>
              saveSettings({ ...settings, mealTemplates }, notice)
            }
          />
          </DraftBoundary>
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
