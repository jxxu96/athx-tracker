"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  CloudOff,
  Dumbbell,
  Keyboard,
  RotateCw,
  ScrollText,
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
import {
  chordLabel,
  setKeyboardShortcutsEnabled,
  useCommandKey,
  useKeyboardShortcutSetting,
  useKeyboardShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { useLoggingFor, type LoggingFor } from "@/hooks/use-logging-for";
import { Countdown } from "@/components/countdown";
import { ThemeSync } from "@/components/theme-toggle";
import { DraftBoundary } from "@/components/draft-boundary";
import { Drafts } from "@/components/drafts";
import { HeldDraft } from "@/components/held-draft";
import {
  ATHLETES,
  localDay,
  RECENT_LIMIT,
  type Bodyweight,
  type EnergyCheckIn,
  type FeatureRequest,
  type Meal,
  type RecordItem,
  type Settings,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";
import { athleteOutline } from "@/lib/athlete-outline";
import { bodyweightHistory } from "@/lib/bodyweight";
import { sameCheckInDay } from "@/lib/energy-level";
import { bestLine, type NewBest } from "@/lib/bests";
import { api, isMeal, isWorkout, message, newId, sortRecords } from "@/lib/client";
import { draftsElsewhere, refreshElsewhere, releaseWhenCached } from "@/lib/draft-locks";
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
  draftToReopen,
  draftsSnapshot,
  dropDraft,
  dropDraftsFor,
  openDraft,
  setTabDraft,
  tabDraft,
  type Draft,
  type DraftKind,
} from "@/lib/drafts";

type Tab = "today" | "session" | "meal" | "progress" | "log" | "settings";

/** A form, on screen or set aside, and what it opened with. */
type FormSlot<T extends Meal | Workout> = {
  /** One per form: a meal set aside keeps its form, and its estimate, mounted. */
  key: string;
  /** The draft the form writes, held for this tab while the form is mounted. */
  draftId: string;
  draft: Draft | null;
  editing: T | null;
  /** Who it is for once set aside. The header's switch is the shown form's. */
  who: LoggingFor;
  /** Opened by itself, on coming back to the app: if another tab has it, say nothing. */
  quiet?: boolean;
};

/** Every meal form this tab has mounted, and the one on screen. */
type MealForms = { slots: FormSlot<Meal>[]; shown: string | null };

/** A form with nothing in it, or one opened on a draft or on an entry to edit. */
function formSlot<T extends Meal | Workout>(
  who: LoggingFor,
  { draft = null, editing = null, quiet }: { draft?: Draft | null; editing?: T | null; quiet?: boolean } = {},
): FormSlot<T> {
  return {
    key: newId(),
    draftId: draft?.id ?? newId(),
    draft,
    editing: draft ? (draft.editing as T | null) : editing,
    who: draft?.who ?? who,
    ...(quiet ? { quiet } : {}),
  };
}

// Five, the most a bottom bar holds. Setup is opened rarely, so it is the
// gear in the header. Log has its own icon: the circular arrow is Refresh's.
const TABS = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "session", label: "Session", icon: Dumbbell },
  { id: "meal", label: "Meal", icon: UtensilsCrossed },
  { id: "log", label: "Log", icon: ScrollText },
  { id: "progress", label: "Progress", icon: TrendingUp },
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
/** How often a meal estimating in the background is looked for, while one is. */
const FILL_CHECK_MS = 15_000;

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
  queueReady,
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
  /** Whether a meal saved to be estimated in the background will ever be. */
  queueReady: boolean;
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
  const shortcutSetting = useKeyboardShortcutSetting();
  const shortcutsEnabled = shortcutSetting === "on";
  const command = useCommandKey();
  const estimateChord = chordLabel(command, "e");
  const saveChord = chordLabel(command, "s");
  const activeTab = useRef(tab);
  // One switch drives both forms: which columns the session shows, and who a
  // new meal is saved for. "both" writes both athletes. Each phone opens on
  // whoever it last logged for, Hippos until it has chosen.
  const [who, setWho] = useLoggingFor();
  const whoRef = useRef(who);
  useEffect(() => {
    whoRef.current = who;
  }, [who]);
  // Each kind has its own forms, so editing one kind never remounts the
  // other's estimate. There can be several meals: one set aside while it
  // estimates stays mounted, out of sight, until its answer is in its draft.
  // Nothing until a section is first opened.
  const [meals, setMeals] = useState<MealForms>({ slots: [], shown: null });
  const [session, setSession] = useState<FormSlot<Workout> | null>(null);
  const mealsRef = useRef(meals);
  useEffect(() => {
    mealsRef.current = meals;
  }, [meals]);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // Whether each meal form is estimating, as it last said.
  const mealWorking = useRef(new Map<string, boolean>());
  useEffect(() => {
    for (const key of [...mealWorking.current.keys()])
      if (!meals.slots.some((slot) => slot.key === key)) mealWorking.current.delete(key);
  }, [meals.slots]);
  const formOpened = useRef({ meal: false, session: false });
  // Setup stays mounted once opened, like the forms, so typing in it survives
  // a visit to another tab.
  const [setupOpened, setSetupOpened] = useState(false);

  /** The draft a form shows, which a reload of this tab, or the next fresh start, opens with. */
  const markShown = useCallback((kind: DraftKind, id: string) => {
    setTabDraft(kind, id);
    changeDrafts((book) => openDraft(book, kind, id));
  }, []);

  /**
   * Puts a meal form on screen: one this tab has mounted, or a new one. The
   * one that was there is set aside: kept mounted while it estimates, so the
   * answer still lands on it, and otherwise let go, its draft in Drafts.
   */
  const showMeal = useCallback((slot: FormSlot<Meal>) => {
    const mounted = mealsRef.current.slots.find(
      (held) => held.key === slot.key || held.draftId === slot.draftId,
    );
    const next = mounted ?? slot;
    toast.dismiss(`meal-estimate-${next.draftId}`);
    if (mealsRef.current.shown === next.key) return;
    const asideWho = whoRef.current;
    setMeals((forms) => {
      if (forms.shown === next.key) return forms;
      const kept = forms.slots.flatMap((held) => {
        if (held.key === next.key || held.key !== forms.shown) return [held];
        return mealWorking.current.get(held.key) ? [{ ...held, who: asideWho }] : [];
      });
      return {
        slots: kept.some((held) => held.key === next.key) ? kept : [...kept, next],
        shown: next.key,
      };
    });
    // A meal set aside comes back for whoever it was for. A draft opening
    // afresh takes its athlete once this tab holds it.
    if (mounted && !mounted.editing) setWho(mounted.who);
    markShown("meal", next.draftId);
  }, [markShown, setWho]);

  /** A session has one form, which this replaces. */
  const showSession = useCallback((slot: FormSlot<Workout>) => {
    setSession(slot);
    markShown("session", slot.draftId);
  }, [markShown]);

  /**
   * Opens a draft on its form, as it was left: an edit as that edit. It draws
   * once this tab holds the draft, which a tab that has it open keeps.
   */
  const openDraftOnForm = useCallback((draft: Draft, quiet = false) => {
    const open = () => {
      if (draft.kind === "meal") showMeal(formSlot(whoRef.current, { draft, quiet }));
      else if (sessionRef.current?.draftId !== draft.id)
        showSession(formSlot(whoRef.current, { draft, quiet }));
    };
    if (quiet) return open();
    // Asked afresh rather than as Drafts last showed it, since the tab that
    // had it may have closed since. One still open there leaves this form be.
    void refreshElsewhere().then(() => {
      if (!draftsElsewhere().has(draft.id)) return open();
      toast(`That ${draft.kind === "meal" ? "meal" : "session"} is open in another tab.`);
    });
  }, [showMeal, showSession]);

  const navigate = useCallback((next: Tab) => {
    activeTab.current = next;
    setTab(next);
    if (next === "settings") setSetupOpened(true);
    if (next === "meal" || next === "session") {
      // The first time a form opens, it opens on whatever this tab left typed
      // in it, or, in a tab the app was just opened in, whatever was left in
      // any, so closing the app mid-meal loses nothing. Unless another tab
      // still has it open: then this one starts afresh.
      if (!formOpened.current[next]) {
        formOpened.current[next] = true;
        const left = draftToReopen(draftsSnapshot(), next, tabDraft(next));
        if (left) openDraftOnForm(left, true);
        else if (next === "meal") showMeal(formSlot(whoRef.current));
        else showSession(formSlot(whoRef.current));
      }
      const onScreen = mealsRef.current.slots.find((slot) => slot.key === mealsRef.current.shown);
      toast.dismiss(next === "meal" ? `meal-estimate-${onScreen?.draftId}` : "session-estimate");
    }
    window.scrollTo(0, 0);
  }, [openDraftOnForm, showMeal, showSession]);

  // Setup lists every one of these. The keys are fixed.
  useKeyboardShortcuts(shortcutsEnabled, {
    g: () => setWho("gators"),
    h: () => setWho("hippos"),
    v: () => setWho("both"),
    w: () => navigate("session"),
    m: () => navigate("meal"),
    t: () => navigate("today"),
    p: () => navigate("progress"),
  }, (action) => action());

  /** An entry from the Log, picking up any unsaved edit of it. Whatever was on the form is set aside. */
  const openEdit = useCallback((record: Meal | Workout) => {
    const kind: DraftKind = record.kind === "meal" ? "meal" : "session";
    formOpened.current[kind] = true;
    const left = draftFor(draftsSnapshot(), record.id);
    if (left) openDraftOnForm(left);
    else if (record.kind === "meal")
      showMeal(
        mealsRef.current.slots.find((slot) => slot.editing?.id === record.id) ??
          formSlot(whoRef.current, { editing: record }),
      );
    else showSession(formSlot(whoRef.current, { editing: record }));
    navigate(kind);
  }, [navigate, openDraftOnForm, showMeal, showSession]);

  /** A fresh form; whatever was on it stays in Drafts unless it was discarded. */
  const startNew = useCallback((kind: DraftKind) => {
    if (kind === "meal") showMeal(formSlot(whoRef.current));
    else showSession(formSlot(whoRef.current));
    window.scrollTo(0, 0);
  }, [showMeal, showSession]);

  /** A meal form that is done with, saved or cancelled, gives way to a fresh one. */
  const replaceMeal = useCallback((key: string) => {
    const fresh = formSlot<Meal>(whoRef.current);
    const onScreen = mealsRef.current.shown === key;
    setMeals((forms) => ({
      slots: forms.slots.map((slot) => (slot.key === key ? fresh : slot)),
      shown: forms.shown === key ? fresh.key : forms.shown,
    }));
    if (onScreen) markShown("meal", fresh.draftId);
  }, [markShown]);

  /** A draft the form could not draw is set aside, so it cannot fail again. */
  const draftFailed = useCallback((draft: Draft | null) => {
    if (!draft) return;
    changeDrafts((book) => dropDraft(book, draft.id));
    toast.error("A draft could not be opened, so it was removed.");
  }, []);

  /** Why a draft did not open: another tab has it, or it went while this one waited. */
  const refusedNotice = (kind: DraftKind, held: boolean) =>
    held
      ? "That draft was saved or deleted in another tab."
      : `That ${kind === "meal" ? "meal" : "session"} is open in another tab.`;

  /** A draft that did not open leaves a fresh form in its place. */
  const mealRefused = useCallback((slot: FormSlot<Meal>, held: boolean) => {
    if (!slot.quiet) toast(refusedNotice("meal", held));
    replaceMeal(slot.key);
  }, [replaceMeal]);
  const sessionRefused = useCallback((slot: FormSlot<Workout>, held: boolean) => {
    if (!slot.quiet) toast(refusedNotice("session", held));
    showSession(formSlot(whoRef.current));
  }, [showSession]);

  /** A draft that opened brings its athlete into the header, as the form on screen. */
  const draftOpened = useCallback((draft: Draft) => {
    if (!draft.editing) setWho(draft.who);
  }, [setWho]);

  /**
   * A meal set aside while it estimates is let go of once it has finished:
   * its form says so only after writing its draft, which holds the answer.
   */
  const mealWorkingChanged = useCallback((key: string, working: boolean) => {
    mealWorking.current.set(key, working);
    if (working) return;
    setMeals((forms) =>
      forms.shown === key || !forms.slots.some((slot) => slot.key === key)
        ? forms
        : { ...forms, slots: forms.slots.filter((slot) => slot.key !== key) },
    );
  }, []);

  /** Back to a meal: its form if still mounted, else its draft. */
  const viewMeal = useCallback((draftId: string) => {
    navigate("meal");
    const mounted = mealsRef.current.slots.find((slot) => slot.draftId === draftId);
    if (mounted) return showMeal(mounted);
    const draft = draftsSnapshot().drafts.find((item) => item.id === draftId);
    if (draft) openDraftOnForm(draft);
  }, [navigate, openDraftOnForm, showMeal]);

  const estimateFinished = useCallback((error?: string) => {
    if (activeTab.current === "session") return;
    const options = {
      id: "session-estimate",
      description: error ?? "Review the filled fields before saving.",
      duration: Infinity,
      closeButton: true,
      action: { label: "View session", onClick: () => navigate("session") },
    };
    if (error) toast.error("Session estimate failed", options);
    else toast.success("Session estimate ready", options);
  }, [navigate]);

  /**
   * A meal's estimate is in. Said unless that meal is on screen, from another
   * section or set aside for the next meal, naming the meal and opening it.
   */
  const mealEstimateFinished = useCallback(
    (slot: FormSlot<Meal>, error: string | undefined, called: string) => {
      if (activeTab.current === "meal" && mealsRef.current.shown === slot.key) return;
      const options = {
        id: `meal-estimate-${slot.draftId}`,
        description: `${called} · ${error ?? "Review the filled fields before saving."}`,
        duration: Infinity,
        closeButton: true,
        action: { label: "View meal", onClick: () => viewMeal(slot.draftId) },
      };
      if (error) toast.error("Meal estimate failed", options);
      else toast.success("Meal estimate ready", options);
    },
    [viewMeal],
  );
  const sides = who === "both" ? (["hippos", "gators"] as const) : ([who] as const);
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  // Meals seen here while their estimate was still running in the background,
  // so the moment one comes back filled can be announced.
  const awaitingFill = useRef(new Set<string>());
  const [settings, setSettings] = useState(initialSettings);
  const [revision, setRevision] = useState(initialRevision);
  // Setup is keyed on this, so settings that arrive from elsewhere open it
  // afresh. A unit switched in the header does not: Setup's boxes follow it,
  // and what was typed there stays.
  const [setupKey, setSetupKey] = useState(initialRevision);
  // A unit switched here that the server does not have yet. It shows at
  // once, and holds on this phone while there is no connection, so a session
  // logged at the gym still switches; it is sent when the server answers.
  const [pendingUnit, setPendingUnit] = useState<WeightUnit | null>(null);
  const sendingUnit = useRef(false);
  /** The last unit tapped, which a send that lands after it must not undo. */
  const wantedUnit = useRef<WeightUnit | null>(null);
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
  const savedUnit = settings.weightUnit ?? "lb";
  const unit = pendingUnit ?? savedUnit;
  // What the screens read: the settings, with a switch not yet sent.
  const shownSettings = useMemo(
    () => (pendingUnit ? { ...settings, weightUnit: pendingUnit } : settings),
    [pendingUnit, settings],
  );

  /** What this phone has not sent yet, shown as if it had been. */
  const outbox = useSyncExternalStore(subscribeOutbox, outboxSnapshot, serverOutbox);
  const shown = useMemo(() => sortRecords(applyOutbox(records, outbox)), [records, outbox]);
  // Newest first, like everything shown: a lift's last time is the first match.
  const workouts = useMemo(() => shown.filter(isWorkout), [shown]);
  const mealRecords = useMemo(() => shown.filter(isMeal), [shown]);
  const shownMeal = meals.slots.find((slot) => slot.key === meals.shown) ?? null;
  // Meals set aside here and still estimating, which Drafts says are.
  const mealsAside = useMemo(
    () => new Set(meals.slots.filter((slot) => slot.key !== meals.shown).map((slot) => slot.draftId)),
    [meals],
  );
  // A page kept in the back/forward cache must not go on holding its drafts.
  useEffect(() => releaseWhenCached(), []);
  // Setup keeps what was typed in it until it is saved or discarded, on any
  // tab, so a refresh in the meantime must not reopen it: the form is keyed on
  // the settings revision. The gear says when it holds unsaved changes.
  const setupDirty = useRef(false);
  const [setupUnsaved, setSetupUnsaved] = useState(false);
  const markSetupDirty = useCallback((dirty: boolean) => {
    setupDirty.current = dirty;
    setSetupUnsaved(dirty);
  }, []);
  // Discarding reopens Setup from the settings as they are.
  const [setupReset, setSetupReset] = useState(0);
  const discardSetup = useCallback(() => {
    markSetupDirty(false);
    setSetupReset((current) => current + 1);
  }, [markSetupDirty]);
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
        setSetupKey(config.revision);
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
  // It leaves Setup alone while Setup holds unsaved typing, which would
  // otherwise vanish from another tab without a word.
  const refresh = useCallback(
    () => reload(scope, { keepSettings: setupDirty.current }),
    [reload, scope],
  );
  /** Settings as the server has them, whatever Setup holds: after a restore or a clash. */
  const reloadSettings = useCallback(() => reload(scope), [reload, scope]);
  const loadAll = useCallback(() => reload("all"), [reload]);

  const loadFuelWindow = useCallback(async (from: string, to: string, signal: AbortSignal) => {
    const requestTimeout = timeout(SAVE_TIMEOUT_MS);
    const { records: entries } = await api<{ records: RecordItem[] }>(
      from === to ? `/api/records?day=${from}` : `/api/records?from=${from}&to=${to}`,
      { signal: requestTimeout && typeof AbortSignal.any === "function"
        ? AbortSignal.any([signal, requestTimeout])
        : requestTimeout ?? signal },
    );
    if (signal.aborted) return;
    // Pending edits and deletes are still applied by the outbox over this copy.
    const ids = new Set(entries.map((record) => record.id));
    setRecords((current) => sortRecords([
      ...current.filter((record) => (record.day < from || record.day > to) && !ids.has(record.id)),
      ...entries,
    ]));
  }, []);

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
    // Saved here: whatever it is now, nobody needs telling it was filled in.
    for (const record of batch) awaitingFill.current.delete(record.id);
    setRecords((current) =>
      sortRecords([
        ...batch,
        ...current.filter((item) => !batch.some((r) => r.id === item.id || sameCheckInDay(r, item))),
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

  /** A form's submit. That form then gives way to a fresh one; any meal set aside goes on estimating. */
  const save = useCallback(
    async (batch: (Workout | Meal)[], slot: FormSlot<Meal> | FormSlot<Workout>) => {
      let result: Awaited<ReturnType<typeof persist>>;
      try {
        result = await persist(batch);
      } catch (error) {
        toast.error(message(error));
        throw error;
      }

      const label = slot.editing && batch.some((record) => record.id === slot.editing?.id)
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
      if (batch[0]?.kind === "meal") replaceMeal(slot.key);
      else showSession(formSlot(whoRef.current));
      navigate("today");
      if (!result.reason) void refreshSummary();
    },
    [announceBests, navigate, persist, refreshSummary, replaceMeal, showSession],
  );

  /** A weigh-in or check-in edited in the Log: saved where it stands, without leaving it. */
  const update = useCallback(async (record: Bodyweight | EnergyCheckIn) => {
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

  /**
   * Today's energy, tapped on its card. No notice when it lands: the level
   * it shows chosen says so. One that waits on the phone, or is refused, does say.
   */
  const checkIn = useCallback(async (record: EnergyCheckIn) => {
    try {
      const result = await persist([record]);
      if (result.reason) toast("Saved on this phone", { description: result.reason, icon: <CloudOff className="size-4" /> });
    } catch (error) {
      toast.error(message(error));
      throw error;
    }
  }, [persist]);

  /**
   * An idea on Today's request log. No notice when it lands: the line it
   * adds, or the one it strikes through, says so. One that waits, or is
   * refused, does say.
   */
  const saveRequest = useCallback(async (record: FeatureRequest) => {
    try {
      const result = await persist([record]);
      if (result.reason) toast("Saved on this phone", { description: result.reason, icon: <CloudOff className="size-4" /> });
    } catch (error) {
      toast.error(message(error));
      throw error;
    }
  }, [persist]);

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

  // A meal saved to be estimated in the background says so when its figures
  // arrive, from whichever tab is open: found by the check below, or by any
  // other refresh that happens to bring it in first.
  useEffect(() => {
    const filled = records.filter(
      (record): record is Meal => isMeal(record) && record.source !== "queued" && awaitingFill.current.has(record.id),
    );
    awaitingFill.current = new Set(
      records.filter((record) => isMeal(record) && record.source === "queued").map((record) => record.id),
    );
    if (!filled.length) return;
    void refreshSummary();
    const names = [...new Set(filled.map((meal) => meal.name))];
    toast.success(names.length > 1 ? "Meal estimates ready" : "Meal estimate ready", {
      id: "background-estimate",
      description: names.join(", "),
      duration: Infinity,
      closeButton: true,
      // Two records for one meal logged for both athletes: the Log shows both.
      action: filled.length === 1
        ? { label: "View meal", onClick: () => openEdit(filled[0]) }
        : { label: "View log", onClick: () => navigate("log") },
    });
  }, [records, openEdit, navigate, refreshSummary]);

  // While one is waiting, its day is fetched again now and then, which is all
  // a fill needs and far less than reloading the journal.
  const waitingDays = [...new Set(
    records.filter((record) => isMeal(record) && record.source === "queued").map((record) => record.day),
  )].sort().join(",");
  useEffect(() => {
    if (!waitingDays) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const fresh = (await Promise.all(waitingDays.split(",").map((day) =>
          api<{ records: RecordItem[] }>(`/api/records?day=${day}`),
        ))).flatMap((answer) => answer.records);
        const filled = new Map(fresh
          .filter((record) => isMeal(record) && record.source !== "queued" && awaitingFill.current.has(record.id))
          .map((record) => [record.id, record]));
        if (filled.size)
          setRecords((current) => sortRecords(current.map((record) => filled.get(record.id) ?? record)));
      } catch {
        // Offline or asleep: the next check, or the next refresh, finds it.
      }
    }, FILL_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [waitingDays]);

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
    async (
      next: Settings,
      notice = "Settings saved",
      weighIns: Bodyweight[] = [],
      { keepSetup = false, quiet = false } = {},
    ) => {
      try {
        // Weigh-ins are journal entries, so they wait on the phone like any other.
        const logged = weighIns.length ? await persist(weighIns) : null;
        const saved = await api<{ settings: Settings; revision: number }>(
          "/api/settings",
          { method: "PUT", body: JSON.stringify({ settings: next, revision }) },
        );
        // Setup's own edits are still in it after a unit switch, unsaved.
        if (!keepSetup) {
          setupDirty.current = false;
          setSetupKey(saved.revision);
        }
        setSettings(saved.settings);
        setRevision(saved.revision);
        if (notice) toast.success(notice);
        if (logged?.reason)
          toast("Weigh-in saved on this phone", { description: logged.reason, icon: <CloudOff className="size-4" /> });
        void refreshSummary();
      } catch (error) {
        if (!quiet) toast.error(message(error));
        // Someone saved from the other phone: pull their version back in.
        if ((error as Error & { status?: number }).status === 409) await reloadSettings();
        throw error;
      }
    },
    [persist, revision, reloadSettings, refreshSummary],
  );

  /**
   * One switch for every weight on screen, kept with the settings so both
   * phones read the same. The forms convert what is in their boxes when it
   * moves; nothing stored changes, since every weight is kept in kilograms.
   * Back to the saved unit needs nothing sent.
   */
  const switchUnit = (next: WeightUnit) => {
    if (next === unit) return;
    wantedUnit.current = next;
    setPendingUnit(next === savedUnit ? null : next);
  };

  /** Sends a switch the server does not have, one at a time. */
  const sendUnit = useCallback(async (next: WeightUnit) => {
    if (sendingUnit.current) return;
    sendingUnit.current = true;
    try {
      // No toast for it landing: every weight on screen changing says it,
      // and one at the top would sit over the switch just tapped.
      await saveSettings({ ...settings, weightUnit: next }, "", [], { keepSetup: true, quiet: true });
      // Switched again while this was on its way: that one goes next.
      const wanted = wantedUnit.current;
      setPendingUnit(wanted && wanted !== next ? wanted : null);
    } catch (error) {
      if (retryable(error)) {
        toast(`Weights in ${next} on this phone`, {
          description: waitingReason(error),
          icon: <CloudOff className="size-4" />,
        });
        return;
      }
      // Refused, or the other phone saved first: the server's settings stand.
      toast.error(message(error));
      setPendingUnit((current) => (current === next ? null : current));
    } finally {
      sendingUnit.current = false;
    }
  }, [saveSettings, settings]);

  // A switch is sent when made, and again each time the server answers a
  // refresh, until it lands. A failed send leaves nothing changed to retry on.
  // From a timer, so switching back and forth quickly sends only the last.
  useEffect(() => {
    if (!pendingUnit || pendingUnit === savedUnit) return;
    const timer = window.setTimeout(() => void sendUnit(pendingUnit), 0);
    return () => window.clearTimeout(timer);
  }, [pendingUnit, savedUnit, fuelRefresh, sendUnit]);

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
      {/* The theme buttons are in Setup; the page follows the choice everywhere. */}
      <ThemeSync />

      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        {/* Top-aligned, so the days left stay level with the first row of
            buttons when a narrow screen wraps them onto two. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-7 min-w-0 items-center gap-2">
            {/* A refresh and the switches leave no room for this beside the
                athlete pills on a phone, and the name is already on the tab
                and the home screen icon. */}
            <h1 className="hidden min-w-0 text-sm font-semibold tracking-tight sm:block">
              Hippos &amp; Gators ATHX Adventure
            </h1>
            <Countdown eventName={shownSettings.eventName} eventDate={shownSettings.eventDate} today={today} />
          </div>
          {/* Wraps rather than running off a narrow phone, as it would at
              320 px or with entries waiting to send beside the unit switch. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
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
          <div
            role="group"
            aria-label="Weight unit"
            className="flex shrink-0 rounded-full bg-muted p-0.5"
          >
            {(["lb", "kg"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => switchUnit(option)}
                aria-pressed={unit === option}
                title={option === "lb" ? "Pounds" : "Kilograms"}
                className="rounded-full px-1.5 py-0.5 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                {option}
              </button>
            ))}
          </div>
          {shortcutSetting !== "unavailable" ? (
            <button
              type="button"
              onClick={() => setKeyboardShortcutsEnabled(!shortcutsEnabled)}
              aria-label="Keyboard shortcuts"
              aria-pressed={shortcutsEnabled}
              title={`Keyboard shortcuts · G Gators, H Hippos, V Both, W Session, M Meal, T Today, P Progress, Y Yesterday · In Session: D Today, ${estimateChord} Fill with AI, ${saveChord} Save · In Meal: B Breakfast, L Lunch, D Dinner, S Snack, A Alcohol, ${estimateChord} Estimate, ${saveChord} Save`}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85"
            >
              <Keyboard className="size-4" />
            </button>
          ) : null}
          {/* The name stays "Setup", so it can always be asked for by name;
              unsaved typing in it is the description, and the dot. */}
          <button
            type="button"
            onClick={() => navigate("settings")}
            aria-label="Setup"
            aria-describedby={setupUnsaved ? "setup-unsaved" : undefined}
            aria-current={tab === "settings" ? "page" : undefined}
            title={setupUnsaved ? "Setup · unsaved changes" : "Setup"}
            className="relative rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current]:bg-muted aria-[current]:text-foreground"
          >
            <SettingsIcon className="size-4" />
            {setupUnsaved ? (
              <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
            ) : null}
          </button>
          {setupUnsaved ? <span id="setup-unsaved" hidden>Unsaved changes</span> : null}
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
            settings={shownSettings}
            history={history}
            figures={figures}
            today={today}
            onLoadFuelWindow={loadFuelWindow}
            fuelRefresh={fuelRefresh}
            heldFrom={heldFrom}
            onLoadSessions={loadSessions}
            onCheckIn={checkIn}
            onSaveRequest={saveRequest}
            onDeleteRequest={remove}
            shortcutsEnabled={shortcutsEnabled}
          />
        ) : tab === "progress" ? (
          <Progress
            records={shown}
            settings={shownSettings}
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
              if (record.kind === "meal" || record.kind === "workout") openEdit(record);
            }}
            onUpdate={update}
            onDelete={remove}
          />
        ) : null}
        {/* Keep visited forms mounted: hiding a section must not cancel its
            request or discard its draft, even if a refresh reports an error.
            Setup too, so what was typed there waits for Save or Discard. */}
        {setupOpened ? (
          <div hidden={Boolean(problem) || tab !== "settings"}>
            <SettingsForm
              key={`${setupKey}-${setupReset}`}
              settings={shownSettings}
              history={history}
              today={today}
              grokReady={grokReady}
              onRefresh={reloadSettings}
              onSave={saveSettings}
              onDirty={markSetupDirty}
              onDiscard={discardSetup}
            />
          </div>
        ) : null}
        <div hidden={Boolean(problem) || tab !== "session"}>
        {session ? (
          <Drafts kind="session" today={today} shown={session.draftId} onOpen={(draft) => openDraftOnForm(draft)} />
        ) : null}
        {session ? (
          <DraftBoundary
            key={session.key}
            onError={() => draftFailed(session.draft)}
            onReset={() => startNew("session")}
          >
          <HeldDraft
            id={session.draftId}
            draft={session.draft}
            onOpened={draftOpened}
            onRefused={(held) => sessionRefused(session, held)}
          >
          {(draft) => (
          <WorkoutForm
            today={today}
            grokReady={grokReady}
            workouts={workouts}
            sides={sides}
            onLoggingFor={setWho}
            weightUnit={unit}
            active={tab === "session" && !problem}
            shortcutsEnabled={shortcutsEnabled}
            draftId={session.draftId}
            editing={session.editing}
            draft={draft}
            onCancelEdit={() => showSession(formSlot(whoRef.current))}
            onStartNew={() => startNew("session")}
            onEstimateComplete={estimateFinished}
            onSave={(batch) => save(batch, session)}
          />
          )}
          </HeldDraft>
          </DraftBoundary>
        ) : null}
        </div>
        <div hidden={Boolean(problem) || tab !== "meal"}>
        {shownMeal ? (
          <Drafts
            kind="meal"
            today={today}
            shown={shownMeal.draftId}
            estimating={mealsAside}
            onOpen={(draft) => openDraftOnForm(draft)}
          />
        ) : null}
        {/* Every meal form this tab has mounted. Only one is on screen; the
            others were set aside mid-estimate and wait, out of sight, for
            their answers. */}
        {meals.slots.map((slot) => {
          const onScreen = slot.key === meals.shown;
          return (
            <div key={slot.key} hidden={!onScreen}>
              <DraftBoundary onError={() => draftFailed(slot.draft)} onReset={() => replaceMeal(slot.key)}>
              <HeldDraft
                id={slot.draftId}
                draft={slot.draft}
                onOpened={draftOpened}
                onRefused={(held) => mealRefused(slot, held)}
              >
              {(draft) => (
              <MealForm
                draftId={slot.draftId}
                shown={onScreen}
                // The header's switch is the meal on screen's. One set aside
                // keeps whoever it was for when it was.
                loggingFor={slot.editing?.athlete ?? (onScreen ? who : slot.who)}
                meals={mealRecords}
                templates={settings.mealTemplates}
                today={today}
                grokReady={grokReady}
                queueReady={queueReady}
                active={onScreen && tab === "meal" && !problem}
                shortcutsEnabled={shortcutsEnabled}
                editing={slot.editing}
                draft={draft}
                onLoggingFor={setWho}
                onCancelEdit={() => replaceMeal(slot.key)}
                onStartNew={() => startNew("meal")}
                onDiscard={() => {
                  replaceMeal(slot.key);
                  window.scrollTo(0, 0);
                }}
                onWorking={(working) => mealWorkingChanged(slot.key, working)}
                onEstimateComplete={(error, called) => mealEstimateFinished(slot, error, called ?? "A meal")}
                onSave={(batch) => save(batch, slot)}
                onSaveTemplates={(mealTemplates, notice) =>
                  // Unsaved typing in Setup stays: Setup saves the templates as
                  // they are now, whenever it is saved.
                  saveSettings({ ...settings, mealTemplates }, notice, [], { keepSetup: setupDirty.current })
                }
              />
              )}
              </HeldDraft>
              </DraftBoundary>
            </div>
          );
        })}
        </div>
      </main>

      {/* A fixed height, which Setup's sticky save bar sits just above. */}
      <nav
        aria-label="Sections"
        className="sticky bottom-0 z-20 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            aria-current={tab === id ? "page" : undefined}
            className="flex h-[var(--nav-row)] flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors aria-[current]:text-foreground"
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
