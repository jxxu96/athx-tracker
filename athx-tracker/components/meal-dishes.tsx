"use client";

import { useId, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/workout-form";
import { ATHLETES, ESTIMATORS, type Meal } from "@/lib/domain";
import {
  ASSUMPTIONS_LIMIT,
  DISH_LIMIT,
  DISH_TEXT_LIMIT,
  EATERS,
  QUANTITY_LIMIT,
  looseDishes,
  portionOf,
  readQuantity,
  setFigure,
  setShare,
  shareTotals,
  slideShare,
  sliderSteps,
  sliderValue,
  tidyShare,
  type DishDraft,
  type Eater,
} from "@/lib/meal-dishes";

/** The same boxes, in the same places, as a meal's: three across, then fiber and fat. */
const FIGURES = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "protein", label: "Protein (g)" },
  { key: "carbs", label: "Carbs (g)" },
  { key: "fiber", label: "Fiber (g)" },
  { key: "fat", label: "Fat (g)" },
] as const;

/**
 * One person's percentage, at their end of the slider. It reads to a tenth
 * until it is typed in, then shows everything it holds.
 */
function ShareBox({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        value={typing ? value : tidyShare(value)}
        inputMode="decimal"
        placeholder="0"
        disabled={disabled}
        className="h-10 pr-5 pl-1.5 text-right tabular-nums"
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        onChange={(event) => onChange(event.target.value)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground"
      >
        %
      </span>
    </div>
  );
}

/**
 * A share written on its own part of the bar, centred in it. A part too
 * narrow to hold it beside the divider shows nothing, and the box at that
 * end still says it. A tenth needs more room than a whole number.
 */
function BarLabel({ fraction, side, text }: { fraction: number; side: "start" | "end"; text: string }) {
  return (
    <span
      aria-hidden
      className={`@container pointer-events-none absolute inset-y-0 flex items-center justify-center ${
        side === "start" ? "left-0" : "right-0"
      }`}
      style={{ width: `${fraction * 100}%` }}
    >
      <span
        className={`text-[11px] font-semibold tabular-nums ${
          text.includes(".") ? "@max-[48px]:hidden" : "@max-[38px]:hidden"
        }`}
        // The page's own background reads on both athlete colours, in both
        // themes: white on the light theme's darker inks, near-black on the
        // dark theme's lighter ones.
        style={{ color: "var(--background)" }}
      >
        {text}
      </span>
    </span>
  );
}

/**
 * Who had how much of a dish. Each of you has a box at your end, and the bar
 * between them is the dish: Hippos' part on the left, Gators' on the right,
 * each with its percentage on it, and the handle where the dish divides.
 * Under the bar, the calories each part holds and, for a counted dish, how
 * many. A dish counted in two or more whole units slides a unit at a time;
 * anything else a percent at a time.
 */
function ShareControl({
  dish,
  sitting,
  disabled,
  onDish,
}: {
  dish: DishDraft;
  sitting: Meal["meal"];
  disabled: boolean;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
}) {
  const ids = { hippos: useId(), gators: useId() };
  const [read] = looseDishes([dish], sitting);
  const portions = { hippos: portionOf(read, "hippos"), gators: portionOf(read, "gators") };
  // Said for a screen reader in place of the step count, which means nothing alone.
  const spoken = EATERS.map((eater) =>
    [`${ATHLETES[eater].name} ${portions[eater].percent}`, portions[eater].count, `${portions[eater].calories} kcal`]
      .filter(Boolean)
      .join(", "),
  ).join("; ");
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_3.75rem] items-center gap-x-1.5 gap-y-1">
        {EATERS.map((eater, index) => (
          <Label
            key={eater}
            htmlFor={ids[eater]}
            className={`text-xs font-semibold ${index ? "col-start-3 justify-self-end" : ""}`}
            style={{ color: ATHLETES[eater].ink }}
          >
            {ATHLETES[eater].name}
            <span className="sr-only"> (%)</span>
          </Label>
        ))}
        <ShareBox
          id={ids.hippos}
          value={dish.share.hippos}
          disabled={disabled}
          onChange={(text) => onDish((current) => setShare(current, "hippos", text))}
        />
        <SliderPrimitive.Root
          value={[sliderValue(dish)]}
          min={0}
          max={sliderSteps(dish.quantity)}
          step={1}
          disabled={disabled}
          onValueChange={([value]) => onDish((current) => slideShare(current, value))}
          className="relative flex h-10 min-w-0 touch-none items-center select-none data-[disabled]:opacity-50"
        >
          {/* Inset by half the handle, so the handle always sits where the colours meet. */}
          <SliderPrimitive.Track
            className="relative mx-2 h-7 grow overflow-hidden rounded-full"
            style={{ background: ATHLETES.gators.ink }}
          >
            <SliderPrimitive.Range className="absolute h-full" style={{ background: ATHLETES.hippos.ink }} />
            <BarLabel fraction={read.share.hippos} side="start" text={portions.hippos.percent} />
            <BarLabel fraction={read.share.gators} side="end" text={portions.gators.percent} />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label={`${ATHLETES.hippos.name}' share`}
            aria-valuetext={spoken}
            className="group flex h-10 w-4 cursor-grab items-center justify-center outline-none active:cursor-grabbing data-[disabled]:cursor-default"
          >
            <span className="h-9 w-2.5 rounded-full border border-black/15 bg-white shadow-md ring-ring/60 transition-[box-shadow] group-focus-visible:ring-4" />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>
        <ShareBox
          id={ids.gators}
          value={dish.share.gators}
          disabled={disabled}
          onChange={(text) => onDish((current) => setShare(current, "gators", text))}
        />
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        {EATERS.map((eater, index) => (
          <p key={eater} className={index ? "text-right" : undefined}>
            <span className="font-semibold" style={{ color: ATHLETES[eater].ink }}>
              {portions[eater].calories} kcal
            </span>
            {portions[eater].count ? (
              <span className="block text-muted-foreground">{portions[eater].count}</span>
            ) : null}
          </p>
        ))}
      </div>
    </div>
  );
}

function DishCard({
  dish,
  index,
  sitting,
  grokReady,
  busy,
  locked,
  disabled,
  error,
  onDish,
  onEstimate,
  onRemove,
}: {
  dish: DishDraft;
  index: number;
  sitting: Meal["meal"];
  grokReady: boolean;
  /** This dish is being estimated, so its boxes wait for the answer. */
  busy: boolean;
  /** Another dish is being estimated, and one estimate runs at a time. */
  locked: boolean;
  /**
   * The whole form is busy, saving. Its fieldset holds the boxes, but the
   * slider is not a form control, so it is told directly.
   */
  disabled: boolean;
  error: string;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
  onEstimate: () => void;
  onRemove: () => void;
}) {
  const label = `Dish ${index + 1}`;
  // Shown once the dish has something to show: an estimate's working, or
  // what came over from the meal. An estimate keeps it open even when cleared.
  const explained = dish.assumptions !== "" || dish.confidence !== null;
  const uncounted = dish.quantity.trim() !== "" && !readQuantity(dish.quantity);
  return (
    <div role="group" aria-label={label} className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{label}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Remove dish ${index + 1}`}
          disabled={busy}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Dish"
          value={dish.name}
          maxLength={DISH_TEXT_LIMIT}
          placeholder="Margherita pizza, 12 inch"
          disabled={busy}
          onChange={(event) => {
            const name = event.target.value;
            onDish((current) => ({ ...current, name }));
          }}
        />
        {grokReady ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={busy || locked || dish.name.trim().length < 3}
            onClick={onEstimate}
          >
            <Sparkles />
            {busy ? "Estimating…" : "Estimate"}
          </Button>
        ) : null}
      </div>
      {sitting === "Alcohol" ? (
        <Field label="Ethanol (g)">
          <Input
            value={dish.ethanol}
            inputMode="decimal"
            placeholder="0"
            disabled={busy}
            onChange={(event) => {
              const text = event.target.value;
              onDish((current) => setFigure(current, "ethanol", text));
            }}
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        {FIGURES.map(({ key, label: name }) => (
          <Field key={key} label={name}>
            <Input
              value={dish[key]}
              inputMode="decimal"
              placeholder="0"
              disabled={busy}
              onChange={(event) => {
                const text = event.target.value;
                onDish((current) => setFigure(current, key, text));
              }}
            />
          </Field>
        ))}
      </div>
      {dish.confidence || dish.estimator ? (
        <p className="text-xs text-muted-foreground">
          {dish.estimator === "average" ? (
            "Averaged across estimators"
          ) : dish.estimator ? (
            <>
              Answered by <span className="font-medium">{ESTIMATORS[dish.estimator]}</span>
            </>
          ) : null}
          {dish.confidence ? (
            <>
              {dish.estimator ? " · " : null}
              Confidence: <span className="font-medium">{dish.confidence}</span>
            </>
          ) : null}
          {dish.adjusted ? " · saved as your own numbers after your edit" : null}
        </p>
      ) : null}
      {explained ? (
        <Field label="Assumptions">
          <Textarea
            value={dish.assumptions}
            maxLength={ASSUMPTIONS_LIMIT}
            rows={3}
            // A whole estimate's working can run to pages. The card stays a card.
            className="max-h-60 overflow-y-auto"
            disabled={busy}
            onChange={(event) => {
              const assumptions = event.target.value;
              onDish((current) => ({ ...current, assumptions }));
            }}
          />
        </Field>
      ) : null}
      <Field
        label="Quantity (whole dish)"
        hint={uncounted ? "Start with a number, as in 8 slices, to share it by count." : undefined}
      >
        <Input
          value={dish.quantity}
          maxLength={QUANTITY_LIMIT}
          placeholder="8 slices"
          disabled={busy}
          onChange={(event) => {
            const quantity = event.target.value;
            onDish((current) => ({ ...current, quantity }));
          }}
        />
      </Field>
      <ShareControl dish={dish} sitting={sitting} disabled={busy || disabled} onDish={onDish} />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The dishes on the table, each with its own figures and who had how much of it. */
export function MealDishes({
  dishes,
  sitting,
  grokReady,
  estimating,
  disabled,
  errors,
  onDish,
  onEstimate,
  onRemove,
  onAdd,
}: {
  dishes: DishDraft[];
  sitting: Meal["meal"];
  grokReady: boolean;
  /** The dish being estimated, if one is. */
  estimating: string | null;
  /** The form is saving, so nothing on it should change. */
  disabled: boolean;
  errors: Record<string, string>;
  onDish: (id: string, change: (dish: DishDraft) => DishDraft) => void;
  onEstimate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {dishes.map((dish, index) => (
        <DishCard
          key={dish.id}
          dish={dish}
          index={index}
          sitting={sitting}
          grokReady={grokReady}
          busy={estimating === dish.id}
          locked={estimating !== null}
          disabled={disabled}
          error={errors[dish.id] ?? ""}
          onDish={(change) => onDish(dish.id, change)}
          onEstimate={() => onEstimate(dish.id)}
          onRemove={() => onRemove(dish.id)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={dishes.length >= DISH_LIMIT}
        onClick={onAdd}
      >
        <Plus />
        Add dish
      </Button>
    </>
  );
}

/** What each meal will hold, as it is typed. */
export function DishShares({
  dishes,
  sitting,
  eaters,
}: {
  dishes: DishDraft[];
  sitting: Meal["meal"];
  eaters: readonly Eater[];
}) {
  const read = looseDishes(dishes, sitting);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Shares"
      className="space-y-1 rounded-xl border bg-muted/40 p-3"
    >
      {eaters.map((eater) => {
        const total = shareTotals(read, eater);
        return (
          <p key={eater} className="text-xs tabular-nums">
            <span className="font-semibold" style={{ color: ATHLETES[eater].ink }}>
              {ATHLETES[eater].name}
            </span>
            {` · ${Math.round(total.calories)} kcal · P ${Math.round(total.protein)} · C ${Math.round(total.carbs)} · F ${Math.round(total.fat)}`}
            {total.fiber ? ` · Fiber ${Math.round(total.fiber)} g` : ""}
            {total.alcohol ? ` · Ethanol ${Math.round(total.alcohol)} g` : ""}
          </p>
        );
      })}
    </div>
  );
}
