"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  type MealTemplateItem,
} from "@/lib/domain";
import { amountOf, countOf, countSliderMax, ingredientScale, ingredientSliderMax } from "@/lib/meal-ingredients";
import { parseMealItems } from "@/lib/meal-templates";

type SavedItem = MealTemplateItem & { nutrition: NonNullable<MealTemplateItem["nutrition"]> };

/** What an ingredient adds to the meal at the amount it is at, to the calorie. */
const caloriesAt = (item: SavedItem) => Math.round(item.nutrition.macros.calories * ingredientScale(item));

/**
 * One ingredient: its name and what it adds, a slider, and its amount. A
 * counted item's amount is how many of what its figures were estimated for,
 * which a weight typed into it would multiply, so it offers to be weighed in
 * grams instead: the item is estimated once at that weight.
 */
function IngredientRow({
  item,
  removable,
  onAmount,
  onRemove,
  onWeigh,
}: {
  item: SavedItem;
  removable: boolean;
  onAmount: (amount: number) => void;
  onRemove: () => void;
  /** Resolves true once the item is weighed; absent without the estimator. */
  onWeigh?: (grams: number) => Promise<boolean>;
}) {
  const [weighing, setWeighing] = useState<string | null>(null);
  // Enter and then leaving the box would both ask; one estimate is enough.
  const asking = useRef(false);
  const weighed = item.nutrition.grams > 0;
  const label = weighed ? item.name : countOf(item.name).base;
  const amount = amountOf(item);
  const reference = weighed ? item.nutrition.grams : item.nutrition.count ?? amount;

  async function weigh() {
    const grams = Number(weighing);
    if (weighing === null || weighing.trim() === "" || !(grams > 0) || grams > MEAL_TEMPLATE_GRAMS_LIMIT) {
      setWeighing(null);
      return;
    }
    if (asking.current) return;
    asking.current = true;
    try {
      if (await onWeigh?.(grams)) setWeighing(null);
    } finally {
      asking.current = false;
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <p className={`min-w-0 flex-1 truncate text-xs ${amount > 0 ? "" : "text-muted-foreground"}`}>
          {label}
        </p>
        {!weighed && weighing === null && onWeigh ? (
          <button
            type="button"
            aria-label={`Weigh ${label} in grams instead`}
            className="shrink-0 py-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setWeighing("")}
          >
            weigh in g
          </button>
        ) : null}
        {amount > 0 && weighing === null ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {caloriesAt(item).toLocaleString("en-US")} kcal
          </span>
        ) : null}
        {/* The last one stays: a meal with no ingredients has nothing to slide. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${label}`}
          disabled={!removable}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_5rem_1rem] items-center gap-x-2">
        <input
          type="range"
          className="w-full accent-primary"
          aria-label={weighed ? `${label} weight` : `${label} count`}
          aria-valuetext={weighed ? `${amount} g` : `${amount}`}
          min={0}
          max={weighed ? ingredientSliderMax(amount, reference) : countSliderMax(amount, reference)}
          step={weighed ? 0.1 : 0.25}
          value={amount}
          disabled={weighing !== null}
          onChange={(event) => onAmount(event.target.valueAsNumber)}
        />
        {weighing !== null ? (
          <Input
            type="number"
            inputMode="decimal"
            aria-label={`${label} grams`}
            placeholder="grams"
            min={0}
            max={MEAL_TEMPLATE_GRAMS_LIMIT}
            step={0.1}
            value={weighing}
            autoFocus
            onChange={(event) => setWeighing(event.target.value)}
            onBlur={() => void weigh()}
            onKeyDown={(event) => {
              // Inside the meal form, Enter would save the meal.
              if (event.key === "Enter") {
                event.preventDefault();
                void weigh();
              }
              if (event.key === "Escape") setWeighing(null);
            }}
          />
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            aria-label={weighed ? `${label} grams` : `How many ${label}`}
            min={0}
            max={weighed ? MEAL_TEMPLATE_GRAMS_LIMIT : 1000}
            step={weighed ? 0.1 : 0.25}
            // Blank at zero, so typing into it never leaves a leading 0 ("05").
            value={amount > 0 ? amount : ""}
            placeholder="0"
            onChange={(event) => onAmount(event.target.value === "" ? 0 : event.target.valueAsNumber)}
          />
        )}
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {weighed || weighing !== null ? "g" : "×"}
        </span>
      </div>
    </div>
  );
}

/**
 * The meal's ingredients, each with its own saved figures, so every one
 * slides without asking the estimator again. A weighed item slides in grams;
 * a counted one, "2 eggs" or "250ml 2% milk", by how many. Slid to zero, an
 * item is left out of the meal and kept as an option. Each says what it adds,
 * so an amount typed in the wrong unit shows at once.
 */
export function IngredientWeights({
  items,
  canAdd,
  adding,
  error,
  onAmount,
  onRemove,
  onAdd,
  onWeigh,
}: {
  items: SavedItem[];
  /** An added ingredient is estimated on its own, so this needs the estimator. */
  canAdd: boolean;
  adding: boolean;
  error: string;
  onAmount: (index: number, amount: number) => void;
  onRemove: (index: number) => void;
  /** Resolves true once the ingredient is on the meal, so the box can clear. */
  onAdd: (item: MealTemplateItem) => Promise<boolean>;
  /** A counted item weighed instead, estimated once at that weight. */
  onWeigh: (index: number, grams: number) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const full = items.length >= MEAL_TEMPLATE_ITEMS;

  async function add() {
    if (adding || full) return;
    // "3 g decaf coffee" is weighed; "1 banana" or "250ml milk" is counted.
    const [item] = parseMealItems(text);
    if (!item) return setProblem("Name the ingredient.");
    setProblem("");
    if (await onAdd(item)) setText("");
  }

  const shown = problem || error;

  return (
    <fieldset className="space-y-3 rounded-xl border p-3">
      <legend className="px-1 text-xs font-medium">Ingredient weights</legend>
      {items.map((item, index) => (
        <IngredientRow
          // A weighed item is a new row, so a half-typed weight never carries over.
          key={`${index}:${item.nutrition.grams > 0 ? "g" : "×"}`}
          item={item}
          removable={items.length > 1}
          onAmount={(amount) => onAmount(index, amount)}
          onRemove={() => onRemove(index)}
          onWeigh={canAdd ? (grams) => onWeigh(index, grams) : undefined}
        />
      ))}
      {canAdd ? (
        <div className="space-y-1.5 border-t pt-2">
          <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
            <Input
              aria-label="New ingredient"
              placeholder={full ? "No room for more" : "3 g decaf coffee"}
              maxLength={120}
              value={text}
              disabled={adding || full}
              onChange={(event) => {
                setText(event.target.value);
                setProblem("");
              }}
              onKeyDown={(event) => {
                // Inside the meal form, Enter would save the meal.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={adding || full || !text.trim()}
              onClick={() => void add()}
            >
              <Plus />
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Slide one to 0 to leave it out and keep it as an option. A × is how many servings of what was estimated; weigh it in g to give grams instead. Added and weighed ones are estimated once. Update the template to keep changes.
          </p>
          {shown ? <p role="alert" className="text-xs text-destructive">{shown}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
