"use client";

import { useId } from "react";
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
  countShare,
  looseDishes,
  percent,
  portionText,
  readQuantity,
  setFigure,
  setShare,
  shareTotals,
  slideShare,
  sliderSteps,
  sliderValue,
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

function ShareBox({
  eater,
  value,
  disabled,
  onChange,
}: {
  eater: Eater;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <Label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium"
        style={{ color: ATHLETES[eater].ink }}
      >
        {ATHLETES[eater].name} (%)
      </Label>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        placeholder="0"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * Who had how much of a dish. Hippos is the left end and Gators the right, so
 * the thumb is where the dish divides. A dish counted in two or more whole
 * units moves a unit at a time; anything else a percent at a time.
 */
function ShareSlider({
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
  const [read] = looseDishes([dish], sitting);
  // Said for a screen reader in place of the step count, which means nothing alone.
  const spoken = EATERS.map((eater) => [
    ATHLETES[eater].name,
    ...(read.count ? [`${countShare(read.count, read.share[eater])},`] : []),
    `${percent(read.share[eater])}%`,
  ].join(" ")).join("; ");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-xs font-medium" style={{ color: ATHLETES.hippos.ink }}>
          {ATHLETES.hippos.name}
        </span>
        <SliderPrimitive.Root
          value={[sliderValue(dish)]}
          min={0}
          max={sliderSteps(dish.quantity)}
          step={1}
          disabled={disabled}
          onValueChange={([value]) => onDish((current) => slideShare(current, value))}
          className="relative flex h-8 min-w-0 grow touch-none items-center select-none data-[disabled]:opacity-50"
        >
          <SliderPrimitive.Track
            className="relative h-2 grow overflow-hidden rounded-full"
            style={{ background: ATHLETES.gators.ink }}
          >
            <SliderPrimitive.Range className="absolute h-full" style={{ background: ATHLETES.hippos.ink }} />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label={`${ATHLETES.hippos.name}' share`}
            aria-valuetext={spoken}
            className="block size-6 rounded-full border-2 border-foreground/60 bg-background shadow-sm ring-ring/50 transition-[box-shadow] focus-visible:ring-4 focus-visible:outline-hidden"
          />
        </SliderPrimitive.Root>
        <span aria-hidden className="text-xs font-medium" style={{ color: ATHLETES.gators.ink }}>
          {ATHLETES.gators.name}
        </span>
      </div>
      {EATERS.map((eater) => (
        <p key={eater} className="text-xs tabular-nums">
          <span className="font-semibold" style={{ color: ATHLETES[eater].ink }}>
            {ATHLETES[eater].name}
          </span>
          {` · ${portionText(read, eater)}`}
        </p>
      ))}
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
      <ShareSlider dish={dish} sitting={sitting} disabled={busy || disabled} onDish={onDish} />
      <div className="grid grid-cols-2 gap-3">
        {EATERS.map((eater) => (
          <ShareBox
            key={eater}
            eater={eater}
            value={dish.share[eater]}
            disabled={busy}
            onChange={(text) => onDish((current) => setShare(current, eater, text))}
          />
        ))}
      </div>
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
