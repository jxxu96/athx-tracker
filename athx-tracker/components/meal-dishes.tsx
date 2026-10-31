"use client";

import { useId } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/workout-form";
import { ATHLETES, ESTIMATORS, type Meal } from "@/lib/domain";
import {
  DISH_LIMIT,
  DISH_TEXT_LIMIT,
  EATERS,
  looseDishes,
  setFigure,
  setShare,
  shareTotals,
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

function DishCard({
  dish,
  index,
  sitting,
  grokReady,
  busy,
  locked,
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
  error: string;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
  onEstimate: () => void;
  onRemove: () => void;
}) {
  const label = `Dish ${index + 1}`;
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
