"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, MessageCircle, Sparkles, Split, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DayButtons, Field } from "@/components/workout-form";
import { athleteOutline, type AthleteOutline } from "@/lib/athlete-outline";
import {
  ATHLETES,
  ESTIMATORS,
  clockTime,
  isClockTime,
  type Estimator,
  type Macros,
  type Meal,
} from "@/lib/domain";
import { api, message, newId } from "@/lib/client";
import { NDJSON, readEstimate, type PartialEstimate } from "@/lib/estimate-stream";
import { bothOf, isText, oneOf, textOf, type Draft } from "@/lib/drafts";
import { useFormDraft } from "@/hooks/use-form-draft";
import { MealTemplateList } from "@/components/meal-templates";
import { DishShares, MealDishes } from "@/components/meal-dishes";
import { mealKey } from "@/lib/common-meals";
import {
  buildTemplate,
  itemsFromText,
  templateDescription,
  upsertTemplate,
  type MealOffer,
  type MealTemplates,
} from "@/lib/meal-templates";
import {
  CONVERSATION_LIMIT,
  MAX_REPLIES,
  REPLY_LIMIT,
  type MealEstimate as Estimate,
} from "@/lib/estimate-conversation";
import { macroCalories } from "@/lib/meal-calories";
import { fanOutMeal, type LoggingFor, type MealDraft } from "@/lib/meal-fanout";
import { mealForTime } from "@/lib/meal-time";
import {
  EATERS,
  ETHANOL_LIMIT,
  FIBER_LIMIT,
  MACRO_LIMITS as LIMITS,
  dishesOf,
  emptyDish,
  fillDish,
  readDishes,
  splitMeal,
  type DishDraft,
} from "@/lib/meal-dishes";

const MACRO_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack", "Alcohol"] as const;

type MacroDraft = Record<keyof Macros, string>;
const emptyMacros: MacroDraft = { calories: "", protein: "", carbs: "", fat: "" };

type EstimateTurn = { reply?: string; estimate: Estimate };
type Kept = { id: string; athlete: "hippos" | "gators"; sourceKey: string };

function macroDraftOf(value: unknown): MacroDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const held = value as Record<string, unknown>;
  return MACRO_FIELDS.every(({ key }) => typeof held[key] === "string") ? (held as MacroDraft) : undefined;
}

function keptOf(value: unknown): Kept | null {
  if (!value || typeof value !== "object") return null;
  const held = value as Record<string, unknown>;
  return typeof held.id === "string" && typeof held.sourceKey === "string" &&
    (held.athlete === "hippos" || held.athlete === "gators")
    ? (held as Kept)
    : null;
}


/** Today at a time of day, for the sitting it falls in; now when there is none. */
function atTime(time: string) {
  const date = new Date();
  if (isClockTime(time)) date.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
  return date;
}

/** An estimate's figures on one line, as the conversation shows them. */
function figuresOf(estimate: Estimate) {
  return [
    `${Math.round(estimate.calories)} kcal`,
    `${Math.round(estimate.protein)} g protein`,
    `${Math.round(estimate.carbs)} g carbs`,
    ...(estimate.fiber ? [`${Math.round(estimate.fiber)} g fiber`] : []),
    `${Math.round(estimate.fat)} g fat`,
    ...(estimate.alcohol ? [`${Math.round(estimate.alcohol)} g ethanol`] : []),
  ].join(" · ");
}

/**
 * Each estimator that has answered while the rest are still working. These
 * are not the meal's figures: the settled answer may average them, or keep
 * only the best-sourced one.
 */
function SoFar({ partials }: { partials: PartialEstimate[] }) {
  if (!partials.length) return null;
  return (
    <div role="status" aria-label="Answers so far" className="space-y-1.5 rounded-xl border bg-muted/40 p-3 text-xs">
      <p className="font-medium">Answers so far</p>
      <ul className="space-y-1">
        {partials.map(({ provider, estimate }) => (
          <li key={provider}>
            <span className="font-medium">{ESTIMATORS[provider]}</span>
            <span className="text-muted-foreground">
              {": "}
              {figuresOf(estimate)} · {estimate.confidence} confidence
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A saved or usual meal, as the estimate a reply can start from. */
function savedEstimate(meal: Pick<Meal, "name" | "macros" | "assumptions">): Estimate {
  return { ...meal.macros, name: meal.name, assumptions: meal.assumptions, confidence: "low" };
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  fit = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; outline?: AthleteOutline }[];
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MealForm({
  loggingFor,
  meals,
  templates,
  today,
  grokReady,
  queueReady,
  active = true,
  editing,
  draft,
  onLoggingFor,
  onCancelEdit,
  onStartNew,
  onSave,
  onSaveTemplates,
  onEstimateComplete,
}: {
  loggingFor: LoggingFor;
  meals: Meal[];
  templates: MealTemplates | undefined;
  today: string;
  grokReady: boolean;
  /** The background worker can estimate. It asks the gateway, never the direct API. */
  queueReady: boolean;
  active?: boolean;
  editing?: Meal | null;
  /** What was typed here before and not saved, which the form opens with. */
  draft?: Draft | null;
  onLoggingFor: (next: LoggingFor) => void;
  onCancelEdit?: () => void;
  /** Set this meal aside in Drafts and start a fresh one. */
  onStartNew?: () => void;
  onSave: (batch: Meal[]) => Promise<void>;
  onSaveTemplates: (next: MealTemplates, notice: string) => Promise<void>;
  onEstimateComplete?: (error?: string) => void;
}) {
  // Controlled by the switch in the header, so the two never disagree.
  // An open edit stays on that record's athlete; the header keeps its own switch.
  const who: LoggingFor = editing ? editing.athlete : loggingFor;
  // A draft's fields win over the entry being edited: they are what was typed since.
  const from = draft?.state ?? null;
  const [day, setDay] = useState(textOf(from?.day, editing?.day ?? today));
  // A new meal starts at the clock; an older one without a time stays without.
  const [time, setTime] = useState(textOf(from?.time, editing ? editing.time ?? "" : clockTime()));
  // A new meal follows its time of day, or the clock when it has none. An
  // edit, or a tap on a usual meal, keeps the sitting that was chosen. Null
  // means "still the clock".
  const [picked, setSlot] = useState<Meal["meal"] | null>(
    from && "picked" in from ? oneOf(from.picked, MEALS) ?? null : editing?.meal ?? null,
  );
  const slot = picked ?? mealForTime(atTime(time));
  // A queued meal keeps what was typed in its assumptions; anything else saved
  // starts from its name, so it can be estimated again without retyping.
  const [description, setDescription] = useState(textOf(
    from?.description,
    editing?.source === "queued" ? editing.assumptions : editing?.name ?? "",
  ));
  const [name, setName] = useState(textOf(from?.name, editing?.name ?? ""));
  const [macros, setMacros] = useState<MacroDraft>(() =>
    macroDraftOf(from?.macros) ?? (editing
      ? {
          calories: String(editing.macros.calories),
          protein: String(editing.macros.protein),
          carbs: String(editing.macros.carbs),
          fat: String(editing.macros.fat),
        }
      : emptyMacros),
  );
  const [ethanol, setEthanol] = useState(textOf(
    from?.ethanol,
    editing?.meal === "Alcohol" ? String(editing.macros.alcohol ?? 0) : "",
  ));
  const [fiber, setFiber] = useState(textOf(from?.fiber, editing ? String(editing.macros.fiber ?? 0) : ""));
  const [assumptions, setAssumptions] = useState(textOf(from?.assumptions, editing?.assumptions ?? ""));
  const [confidence, setConfidence] = useState<Estimate["confidence"] | null>(
    oneOf(from?.confidence, ["low", "medium", "high"] as const) ?? null,
  );
  const [answeredBy, setAnsweredBy] = useState<Estimator | null>(
    from && "answeredBy" in from
      ? oneOf(from.answeredBy, Object.keys(ESTIMATORS) as Estimator[]) ?? null
      : editing?.estimator ?? null,
  );
  const [source, setSource] = useState<Meal["source"]>(
    oneOf(from?.source, ["manual", "grok", "queued"] as const) ?? editing?.source ?? "manual",
  );
  const [adjusted, setAdjusted] = useState(from?.adjusted === true);
  const [estimating, setEstimating] = useState(false);
  // Each estimator's answer as it lands, until the settled one replaces them.
  const [partials, setPartials] = useState<PartialEstimate[]>([]);
  const stopper = useRef<AbortController | null>(null);
  // The estimator turned the description down. Rewording is what helps, so it
  // is not offered to the background estimate until it changes.
  const [rejected, setRejected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Lives with the open draft only. Saving keeps the final macros and
  // assumptions; a saved meal reopens with those as the estimate to reply to.
  const [conversation, setConversation] = useState<EstimateTurn[]>(() =>
    Array.isArray(from?.conversation)
      ? (from.conversation as EstimateTurn[])
      : editing && editing.source !== "queued" ? [{ estimate: savedEstimate(editing) }] : [],
  );
  const [reply, setReply] = useState(textOf(from?.reply, ""));
  const [replyError, setReplyError] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  // The template this draft was filled from, so a later save updates that one
  // rather than adding a second copy. Null is a new template.
  const [kept, setKept] = useState<Kept | null>(keptOf(from?.kept));
  const [templateSaving, setTemplateSaving] = useState(false);
  // A shared meal written down dish by dish. Any dishes at all make this a
  // split meal; removing the last goes back to one meal. An edit is one
  // person's record, so it never splits.
  const [dishes, setDishes] = useState<DishDraft[]>(() => (editing ? [] : dishesOf(from?.dishes)));
  const [estimatingDish, setEstimatingDish] = useState<string | null>(null);
  const [dishErrors, setDishErrors] = useState<Record<string, string>>({});
  const splitting = !editing && dishes.length > 0;
  const eaters = who === "both" ? EATERS : ([who] as const);
  const conversationLog = useRef<HTMLDivElement>(null);
  const replyButton = useRef<HTMLButtonElement>(null);
  const replies = conversation.flatMap((turn) => (turn.reply ? [turn.reply] : []));
  const conversationFull = replies.length >= MAX_REPLIES ||
    replies.join("").length + reply.trim().length > CONVERSATION_LIMIT;
  const canReply = grokReady && !estimating && !saving && !conversationFull &&
    reply.trim().length > 0 && reply.trim().length <= REPLY_LIMIT;

  useEffect(() => {
    if (refineOpen && conversationLog.current)
      conversationLog.current.scrollTop = conversationLog.current.scrollHeight;
  }, [refineOpen, conversation.length, partials.length]);

  // A form that goes away, for a new meal or another draft, takes its estimate
  // with it: nothing would show the answer, so the estimators are stopped.
  useEffect(() => () => stopper.current?.abort(), []);

  // Stable across attempts. The endpoint upserts on id, so a retry after a
  // half-failed save corrects the athlete that landed rather than adding a
  // second copy. New ids only once the whole submit is through.
  const [draftIds, setDraftIds] = useState(() => bothOf(from?.draftIds, isText) ?? {
    hippos: newId(),
    gators: newId(),
  });

  // Everything typed, kept on this phone as it changes. Busy and error states
  // are the moment's, not the meal's, so they stay out.
  const { dirty, finish } = useFormDraft({
    kind: "meal",
    draft,
    editing: editing ?? null,
    who,
    snapshot: JSON.stringify({
      day, time, picked, description, name, macros, ethanol, fiber, assumptions,
      confidence, answeredBy, source, adjusted, conversation, reply, kept, draftIds,
      dishes,
    }),
    summary: (
      name.trim() ||
      dishes.map((dish) => dish.name.trim()).filter(Boolean).join(", ") ||
      description.trim()
    ).slice(0, 80) || "Untitled meal",
    detail: picked ?? mealForTime(atTime(time)),
  });

  const parsedMacros = MACRO_FIELDS.reduce((out, { key }) => {
    out[key] = Number(macros[key].trim());
    return out;
  }, {} as Macros);
  const ethanolRaw = ethanol.trim();
  const ethanolGrams = ethanolRaw === "" ? 0 : Number(ethanolRaw);
  const alcoholGrams = slot === "Alcohol" ? ethanolGrams : 0;
  const ethanolOk = slot !== "Alcohol" || (
    Number.isFinite(ethanolGrams) && ethanolGrams >= 0 && ethanolGrams <= ETHANOL_LIMIT
  );
  const fiberRaw = fiber.trim();
  const fiberGrams = fiberRaw === "" ? 0 : Number(fiberRaw);
  const fiberOk = Number.isFinite(fiberGrams) && fiberGrams >= 0 && fiberGrams <= FIBER_LIMIT
    && Number.isFinite(parsedMacros.carbs) && fiberGrams <= parsedMacros.carbs;
  const counted = { ...parsedMacros, alcohol: alcoholGrams, fiber: fiberGrams };
  const canCheckCalories = ethanolOk && fiberOk &&
    MACRO_FIELDS.some(({ key }) => macros[key].trim() !== "" || (slot === "Alcohol" && ethanolRaw !== "") || fiberRaw !== "") &&
    MACRO_FIELDS.every(({ key }) => Number.isFinite(parsedMacros[key]) &&
      parsedMacros[key] >= 0 && parsedMacros[key] <= LIMITS[key]);
  const breakdown = macroCalories(counted);
  const formatCalories = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  function reset() {
    setDescription("");
    setName("");
    setMacros(emptyMacros);
    setEthanol("");
    setFiber("");
    setAssumptions("");
    setConfidence(null);
    setAnsweredBy(null);
    setSource("manual");
    setAdjusted(false);
    setConversation([]);
    setReply("");
    setReplyError("");
    setRefineOpen(false);
    setRejected(false);
    setKept(null);
    setDishes([]);
    setDishErrors({});
  }

  /**
   * Turns the meal into dishes. Whatever was on the form becomes the first
   * dish, figures and estimate included, and it starts shared half and half.
   * A name typed for the whole meal stays the meal's name, unless it was all
   * there was, in which case it names the dish instead.
   */
  function splitByDish() {
    // Whole: the description is what the figures came from, and what the
    // dish's own estimate will read.
    const text = description.trim() || name.trim();
    const typed = text !== "" || assumptions.trim() !== "" || fiber.trim() !== "" || ethanol.trim() !== "" ||
      MACRO_FIELDS.some(({ key }) => macros[key].trim() !== "");
    const first: DishDraft = typed
      ? {
          ...emptyDish(newId()),
          name: text,
          ...macros,
          fiber,
          ethanol,
          source: source === "grok" ? "grok" : "manual",
          estimator: answeredBy,
          confidence,
          adjusted,
          assumptions,
        }
      : emptyDish(newId());
    const mealName = description.trim() ? name : "";
    reset();
    setName(mealName);
    setError("");
    setDishes([first]);
  }

  function changeDish(id: string, change: (dish: DishDraft) => DishDraft) {
    setDishes((current) => current.map((dish) => (dish.id === id ? change(dish) : dish)));
    setError("");
  }

  function removeDish(id: string) {
    setDishes((current) => current.filter((dish) => dish.id !== id));
    setDishErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setError("");
  }

  /** One dish's own estimate. The dish's text is the description, as typed. */
  async function estimateDish(id: string) {
    if (estimatingDish || saving) return;
    const text = dishes.find((dish) => dish.id === id)?.name.trim() ?? "";
    if (text.length < 3) return;
    setEstimatingDish(id);
    setError("");
    setDishErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const { estimate, provider } = await api<{ estimate: Estimate; provider?: Estimator }>("/api/estimate", {
        method: "POST",
        body: JSON.stringify({ description: text }),
      });
      setDishes((current) => current.map((dish) => (dish.id === id ? fillDish(dish, estimate, provider) : dish)));
      // Ethanol belongs to an Alcohol sitting, as it does for a whole meal.
      if ((estimate.alcohol ?? 0) > 0) setSlot("Alcohol");
      onEstimateComplete?.();
    } catch (problem) {
      onEstimateComplete?.(message(problem));
      setDishErrors((current) => ({ ...current, [id]: message(problem) }));
    } finally {
      setEstimatingDish(null);
    }
  }

  function markManual() {
    setError("");
    if (source === "grok") {
      setSource("manual");
      setAdjusted(true);
    }
  }

  /** A fresh estimate, or with a follow-up, the next turn of the conversation. */
  async function estimate(followUp?: string) {
    if (estimating || saving) return;
    const refining = followUp !== undefined;
    const previous = conversation.at(-1)?.estimate;
    if (refining && (!previous || !canReply)) return;
    setError("");
    setReplyError("");
    setRejected(false);
    setPartials([]);
    const stop = new AbortController();
    stopper.current = stop;
    setEstimating(true);
    try {
      const response = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: `${NDJSON}, application/json` },
        signal: stop.signal,
        body: JSON.stringify({
          description: description.trim().length >= 3 ? description.trim() : `Meal: ${name.trim()}`,
          // The figures on the form, not the last answer, when they have been
          // edited and still make sense, so a reply starts from what you see.
          ...(refining && previous ? {
            refinement: {
              previous: {
                ...previous,
                ...(canCheckCalories ? counted : {}),
                name: name.trim() || previous.name,
                assumptions,
              },
              replies: [...replies, followUp],
            },
          } : {}),
        }),
      });
      const { estimate, provider } = await readEstimate(response, (partial) =>
        setPartials((current) => [...current.filter((held) => held.provider !== partial.provider), partial]),
      );
      setName(estimate.name.slice(0, 300));
      setEthanol(String(estimate.alcohol ?? 0));
      setFiber(String(estimate.fiber ?? 0));
      if ((estimate.alcohol ?? 0) > 0) setSlot("Alcohol");
      setMacros({
        calories: String(estimate.calories),
        protein: String(estimate.protein),
        carbs: String(estimate.carbs),
        fat: String(estimate.fat),
      });
      setAssumptions(estimate.assumptions);
      setConfidence(estimate.confidence);
      setAnsweredBy(provider && provider in ESTIMATORS ? provider : null);
      setSource("grok");
      setAdjusted(false);
      setConversation((current) => refining
        ? [...current, { reply: followUp, estimate }]
        : [{ estimate }]);
      setReply("");
      onEstimateComplete?.();
    } catch (problem) {
      // Stopped on purpose: the form is as it was, ready to edit.
      if (stop.signal.aborted) return;
      onEstimateComplete?.(message(problem));
      if (refining) {
        setReplyError(`${message(problem)} Your current estimate and reply have been kept.`);
        return;
      }
      setError(message(problem));
      // Only 400 means rewording would help. Anything else, unreachable, every
      // CLI failing, the daily cap, can still go to the background estimate,
      // which spends no quota, so a capped meal still gets filled.
      setRejected((problem as Error & { status?: number }).status === 400);
    } finally {
      if (stopper.current === stop) stopper.current = null;
      setEstimating(false);
      setPartials([]);
    }
  }

  function applyOffer(athlete: "hippos" | "gators", offer: MealOffer) {
    if (loggingFor !== athlete) onLoggingFor(athlete);
    setDescription(templateDescription(offer.items) || offer.name);
    setConversation([{ estimate: savedEstimate(offer) }]);
    setReply("");
    setReplyError("");
    setRejected(false);
    setName(offer.name);
    setSlot(offer.meal);
    setMacros({
      calories: String(offer.macros.calories),
      protein: String(offer.macros.protein),
      carbs: String(offer.macros.carbs),
      fat: String(offer.macros.fat),
    });
    setEthanol(offer.macros.alcohol ? String(offer.macros.alcohol) : "");
    setFiber(offer.macros.fiber ? String(offer.macros.fiber) : "");
    setAssumptions(offer.assumptions);
    setSource("manual");
    setAdjusted(false);
    setConfidence(null);
    setAnsweredBy(null);
    setError("");
    setKept(offer.saved ? { id: offer.id, athlete, sourceKey: offer.sourceKey } : null);
  }

  /** Keep the meal on the form, portions and all, without logging it. */
  async function saveAsTemplate() {
    if (estimating || saving || templateSaving) return;
    const problem = validate();
    setError(problem);
    if (problem) return;
    const athletes = who === "both" ? (["hippos", "gators"] as const) : ([who] as const);
    const reuse = athletes.length === 1 && kept?.athlete === athletes[0] ? kept : null;
    let next: MealTemplates = {
      hippos: templates?.hippos ?? [],
      gators: templates?.gators ?? [],
    };
    let keptId: string | null = null;
    for (const athlete of athletes) {
      const built = buildTemplate({
        id: reuse && athlete === reuse.athlete ? reuse.id : newId(),
        name,
        meal: slot,
        items: itemsFromText(description.trim() || name.trim(), name.trim()),
        macros: counted,
        assumptions,
        sourceKey: reuse && athlete === reuse.athlete && reuse.sourceKey
          ? reuse.sourceKey
          : mealKey(name),
      });
      if (!built.ok) {
        setError(built.error);
        return;
      }
      const written = upsertTemplate(next[athlete], built.template);
      if (!written.ok) {
        setError(written.error);
        return;
      }
      next = { ...next, [athlete]: written.templates };
      if (athletes.length === 1) keptId = written.id;
    }
    setTemplateSaving(true);
    try {
      await onSaveTemplates(
        next,
        athletes.length > 1 ? "Templates saved" : reuse ? "Template updated" : "Template saved",
      );
      if (keptId && athletes.length === 1) {
        const saved = next[athletes[0]].find((item) => item.id === keptId);
        setKept(saved ? { id: saved.id, athlete: athletes[0], sourceKey: saved.sourceKey } : null);
      }
    } catch (problem) {
      setError(message(problem));
    } finally {
      setTemplateSaving(false);
    }
  }

  function setMacro(key: keyof Macros, value: string) {
    setMacros((current) => ({ ...current, [key]: value }));
    markManual();
  }

  /** One record, or one per athlete when logging for both. An edit stays singular. */
  function recordsFor(draft: MealDraft) {
    return fanOutMeal({
      loggingFor,
      editing: editing ? { id: editing.id, athlete: editing.athlete } : null,
      draft,
      ids: draftIds,
    });
  }

  async function saveRecords(batch: Meal[]) {
    await onSave(batch);
    // Saved: the draft has done its job.
    finish(true);
    setDraftIds({ hippos: newId(), gators: newId() });
  }

  async function saveDraft(meal: MealDraft) {
    await saveRecords(recordsFor(meal));
  }

  /**
   * Save now with the description kept, and let the worker fill the macros:
   * the same estimators and the same settling, with nobody waiting on it.
   * Pressed mid-estimate, it takes over from the one on screen.
   */
  async function queueForLater() {
    const text = description.trim();
    if (text.length < 3) {
      setError("Describe the meal first, so it can be estimated in the background.");
      return;
    }
    stopper.current?.abort();
    setSaving(true);
    try {
      await saveDraft({
        kind: "meal",
        day,
        ...(time && isClockTime(time) ? { time } : {}),
        name: name.trim() || text.slice(0, 60),
        meal: slot,
        macros: { calories: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0, fiber: 0 },
        source: "queued",
        assumptions: text.slice(0, 3000),
      });
      reset();
    } finally {
      setSaving(false);
    }
  }

  /** The day and time, which a meal and a split meal share. */
  function validateWhen() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Pick a valid date.";
    if (time !== "" && !isClockTime(time)) return "Write the time of day as HH:MM, or leave it empty.";
    return "";
  }

  function validate() {
    if (!name.trim()) return "Name the meal, or run an estimate first.";
    const when = validateWhen();
    if (when) return when;
    if (slot === "Alcohol" && !ethanolOk)
      return ethanolGrams > ETHANOL_LIMIT
        ? "Ethanol looks too high."
        : "Ethanol needs a number of zero or more.";
    for (const { key, label } of MACRO_FIELDS) {
      const raw = macros[key].trim();
      const value = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0)
        return `${label} needs a number of zero or more.`;
      if (value > LIMITS[key]) return `${label} looks too high.`;
    }
    if (!fiberOk) {
      if (!Number.isFinite(fiberGrams) || fiberGrams < 0)
        return "Fiber needs a number of zero or more.";
      if (fiberGrams > FIBER_LIMIT) return "Fiber looks too high.";
      return "Fiber is part of total carbs, so it cannot be higher.";
    }
    if (MACRO_FIELDS.every(({ key }) => parsedMacros[key] === 0) && alcoholGrams === 0)
      return "Add at least one macro value.";
    return "";
  }

  /** One meal for each of you with a share, each holding that share of every dish. */
  async function submitSplit() {
    const when = validateWhen();
    const read = when ? null : readDishes(dishes, slot);
    const split = read?.ok
      ? splitMeal({
          eaters,
          meal: { kind: "meal", day, ...(time ? { time } : {}), meal: slot },
          name,
          dishes: read.dishes,
          ids: draftIds,
        })
      : null;
    const problem = when || (read && !read.ok ? read.error : "") || (split && !split.ok ? split.error : "");
    setError(problem);
    if (problem || !split?.ok) return;
    setSaving(true);
    try {
      await saveRecords(split.meals);
      reset();
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (estimating || saving || estimatingDish) return;
    if (splitting) {
      await submitSplit();
      return;
    }
    const problem = validate();
    setError(problem);
    if (problem) return;

    setSaving(true);
    try {
      await saveDraft({
        kind: "meal",
        day,
        ...(time ? { time } : {}),
        name: name.trim(),
        meal: slot,
        macros: { ...parsedMacros, alcohol: alcoholGrams, fiber: fiberGrams },
        source,
        assumptions: assumptions.trim().slice(0, 3000),
        ...(source === "grok" && answeredBy ? { estimator: answeredBy } : {}),
      });
      reset();
    } finally {
      setSaving(false);
    }
  }

  const busy = estimating || saving || templateSaving;
  // Not once there is an estimate: a queued meal saves zero macros, and would
  // throw away the figures already on the form.
  const canQueue = queueReady && conversation.length === 0 && !rejected;

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      {/* Three fieldsets, not one: the form locks while an estimate runs, and
          Stop and the background estimate between them must not. */}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {editing ? (
          <div
            {...athleteOutline(who, "muted")}
            className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/50 p-3"
          >
            <p className="text-xs">
              Editing <span className="font-medium">{editing.name}</span>
              {draft ? <span className="text-muted-foreground"> · unsaved changes restored</span> : null}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                finish(true);
                onCancelEdit?.();
              }}
            >
              Cancel
            </Button>
          </div>
        ) : dirty || draft ? (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border bg-muted/50 p-3">
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  finish(false);
                  onStartNew?.();
                }}
              >
                New meal
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  finish(true);
                  onStartNew?.();
                }}
              >
                Discard draft
              </Button>
            </div>
          </div>
        ) : null}
        {splitting ? null : (
        <MealTemplateList
          loggingFor={who}
          templates={templates}
          meals={meals}
          today={today}
          grokReady={grokReady}
          disabled={estimating || saving || templateSaving}
          showOffers={!editing}
          formLabel={
            who !== "both" && kept?.athlete === who
              ? "Update this template"
              : "Save this meal as a template"
          }
          onApply={applyOffer}
          onSaveForm={() => void saveAsTemplate()}
          onSaveTemplates={onSaveTemplates}
        />
        )}
        <section {...athleteOutline(who)} className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <Choice
            label="Athlete"
            value={who}
            onChange={(next) => {
              // An edit is one record. Switching here would move the header and
              // leave the open meal looking like it changed athlete.
              if (!editing) onLoggingFor(next);
            }}
            options={(editing
              ? (["hippos", "gators"] as const)
              : (["hippos", "gators", "both"] as const)
            ).map((key) => ({
              value: key,
              label: key === "both" ? "Both" : ATHLETES[key].name,
              outline: key,
            }))}
          />
          <Choice
            label="Sitting"
            value={slot}
            onChange={setSlot}
            options={MEALS.map((value) => ({ value, label: value }))}
            fit
          />
          <DayButtons today={today} day={day} onChange={setDay} time={time} onTimeChange={setTime} />
        </section>
      </fieldset>

      {splitting ? (
        <fieldset disabled={busy} className="min-w-0 space-y-4">
            <section
              {...athleteOutline(who)}
              aria-label="Dishes"
              className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
            >
              <h3 className="text-sm font-semibold">Dishes</h3>
              <MealDishes
                dishes={dishes}
                sitting={slot}
                grokReady={grokReady}
                estimating={estimatingDish}
                disabled={busy}
                errors={dishErrors}
                onDish={changeDish}
                onEstimate={(id) => void estimateDish(id)}
                onRemove={removeDish}
                onAdd={() => {
                  setDishes((current) => [...current, emptyDish(newId())]);
                  setError("");
                }}
              />
            </section>
            <section {...athleteOutline(who)} className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
              <Field label="Meal">
                <Input
                  value={name}
                  maxLength={300}
                  placeholder={dishes.map((dish) => dish.name.trim()).filter(Boolean).join(", ") || "Named after its dishes"}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                />
              </Field>
              <DishShares dishes={dishes} sitting={slot} eaters={eaters} />
            </section>
        </fieldset>
      ) : (
      <section {...athleteOutline(who)} className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Describe it</h3>
            {grokReady ? null : (
              <p className="text-[11px] text-muted-foreground">
                The estimator is not connected, so enter the macros yourself below.
              </p>
            )}
          </div>
          <Textarea
            aria-label="Meal description"
            value={description}
            maxLength={4000}
            rows={3}
            placeholder="Two eggs, 80 g oats with milk, banana, flat white"
            onChange={(event) => {
              setDescription(event.target.value);
              setRejected(false);
            }}
          />
        </fieldset>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!grokReady || busy || description.trim().length < 3}
          onClick={() => estimate()}
        >
          <Sparkles />
          {estimating ? "Estimating…" : "Estimate macros"}
        </Button>
        {estimating ? (
          <Button type="button" variant="outline" className="w-full" onClick={() => stopper.current?.abort()}>
            <Square />
            Stop estimate
          </Button>
        ) : null}
        {canQueue ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={saving || templateSaving || description.trim().length < 3}
            onClick={queueForLater}
          >
            <Clock />
            {saving ? "Saving…" : "Save and estimate in background"}
          </Button>
        ) : null}
        {who === "both" && !editing ? (
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={splitByDish}>
            <Split />
            Split by dish
          </Button>
        ) : null}
        {estimating && !refineOpen ? <SoFar partials={partials} /> : null}
      </section>
      )}

      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {splitting ? null : (
        <>

        {assumptions || conversation.length > 0 ? (
          <section
            {...athleteOutline(who)}
            aria-label="Review estimate"
            className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
          >
            <h3 className="text-sm font-semibold">Review the assumptions</h3>
            <Field label="Assumptions">
              <Textarea
                value={assumptions}
                maxLength={3000}
                rows={4}
                onChange={(event) => setAssumptions(event.target.value)}
              />
            </Field>
            {conversation.length > 0 ? (
              <Button
                ref={replyButton}
                type="button"
                variant="outline"
                className="w-full"
                disabled={!grokReady}
                onClick={() => setRefineOpen(true)}
              >
                <MessageCircle />
                Reply to estimate
              </Button>
            ) : null}
          </section>
        ) : null}

        <section {...athleteOutline(who)} className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <Field label="Meal">
            <Input
              value={name}
              maxLength={300}
              placeholder="Oats, eggs and coffee"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {slot === "Alcohol" ? (
            <Field label="Ethanol (g)">
              <Input
                value={ethanol}
                inputMode="decimal"
                placeholder="0"
                onChange={(event) => {
                  setEthanol(event.target.value);
                  markManual();
                }}
              />
            </Field>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            {MACRO_FIELDS.slice(0, 3).map(({ key, label, unit }) => (
              <Field key={key} label={`${label} (${unit})`}>
                <Input
                  value={macros[key]}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => setMacro(key, event.target.value)}
                />
              </Field>
            ))}
            <Field label="Fiber (g)">
              <Input
                value={fiber}
                inputMode="decimal"
                placeholder="0"
                onChange={(event) => {
                  setFiber(event.target.value);
                  markManual();
                }}
              />
            </Field>
            {MACRO_FIELDS.slice(3).map(({ key, label, unit }) => (
              <Field key={key} label={`${label} (${unit})`}>
                <Input
                  value={macros[key]}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(event) => setMacro(key, event.target.value)}
                />
              </Field>
            ))}
          </div>

          {canCheckCalories ? (
            <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
              <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1">
                <p className="text-xs font-medium">
                  Rough macro estimate: {formatCalories(breakdown.total)} kcal
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    `Protein ${formatCalories(breakdown.protein)}`,
                    `carbs ${formatCalories(breakdown.carbs)}`,
                    ...(breakdown.fiber > 0 ? [`fiber ${formatCalories(breakdown.fiber)}`] : []),
                    `fat ${formatCalories(breakdown.fat)}`,
                    ...(slot === "Alcohol" ? [`ethanol ${formatCalories(breakdown.alcohol)}`] : []),
                  ].join(" + ")} kcal
                </p>
                <p className="text-xs text-muted-foreground">
                  {parsedMacros.calories === breakdown.total
                    ? "Your calorie total equals this rough estimate."
                    : `Your calorie total is ${formatCalories(Math.abs(parsedMacros.calories - breakdown.total))} kcal ${parsedMacros.calories > breakdown.total ? "above" : "below"} this rough estimate.`}
                </p>
              </div>
            </div>
          ) : null}

          {confidence || answeredBy ? (
            <p className="text-xs text-muted-foreground">
              {answeredBy === "average" ? (
                "Averaged across estimators"
              ) : answeredBy ? (
                <>
                  Answered by <span className="font-medium">{ESTIMATORS[answeredBy]}</span>
                </>
              ) : null}
              {confidence ? (
                <>
                  {answeredBy ? " · " : null}
                  Confidence: <span className="font-medium">{confidence}</span>
                </>
              ) : null}
              {adjusted ? " · saved as your own numbers after your edit" : null}
            </p>
          ) : null}
        </section>
        </>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={saving || estimatingDish !== null}>
          {saving ? "Saving…" : editing ? "Update meal" : "Save meal"}
        </Button>
      </fieldset>
      <Dialog open={active && refineOpen} onOpenChange={setRefineOpen}>
        <DialogContent
          className="flex max-h-[85dvh] flex-col p-4 sm:p-6"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (active) replyButton.current?.focus();
          }}
        >
          <DialogHeader className="shrink-0 pr-6 text-left">
            <DialogTitle>Refine estimate</DialogTitle>
          </DialogHeader>
          <div
            ref={conversationLog}
            role="log"
            aria-label="Estimate conversation"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-xl border bg-muted/20 p-3"
          >
            <div className="ml-6 rounded-xl bg-accent p-3 text-sm">
              <p className="mb-1 text-xs font-semibold">Meal description</p>
              <p className="whitespace-pre-wrap break-words">{description || name}</p>
            </div>
            {conversation.map((turn, index) => (
              <div key={index} className="space-y-2">
                {turn.reply ? (
                  <div className="ml-6 rounded-xl bg-accent p-3 text-sm">
                    <p className="mb-1 text-xs font-semibold">You</p>
                    <p className="whitespace-pre-wrap break-words">{turn.reply}</p>
                  </div>
                ) : null}
                <div className="mr-3 rounded-xl border bg-card p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold">Estimator</p>
                  <p className="whitespace-pre-wrap break-words">
                    {turn.estimate.assumptions || "No assumptions supplied."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {figuresOf(turn.estimate)}
                  </p>
                </div>
              </div>
            ))}
            {estimating ? (
              <>
                <p role="status" className="text-sm text-muted-foreground">
                  Re-estimating with your reply…
                </p>
                <SoFar partials={partials} />
              </>
            ) : null}
          </div>
          <div className="shrink-0 space-y-2">
            <Label htmlFor="estimate-reply">Your reply</Label>
            <Textarea
              id="estimate-reply"
              value={reply}
              maxLength={REPLY_LIMIT}
              rows={3}
              disabled={estimating || saving}
              placeholder="It was 150 g of cooked rice, with no oil. Or: why is the fat so high?"
              onChange={(event) => {
                setReply(event.target.value);
                setReplyError("");
              }}
            />
            {conversationFull ? (
              <p className="text-xs text-muted-foreground">
                This conversation is full. Add the final details to the meal description and estimate again.
              </p>
            ) : null}
            {replyError ? (
              <p role="alert" className="text-sm text-destructive">
                {replyError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => setRefineOpen(false)}>
              Back to meal
            </Button>
            {estimating ? (
              <Button type="button" variant="outline" onClick={() => stopper.current?.abort()}>
                <Square />
                Stop
              </Button>
            ) : null}
            <Button type="button" disabled={!canReply} onClick={() => estimate(reply.trim())}>
              <Sparkles />
              {estimating ? "Re-estimating…" : "Send & re-estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
