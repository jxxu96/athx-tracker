"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  type MealTemplateItem,
} from "@/lib/domain";
import { amountOf, countOf, countSliderMax, ingredientSliderMax } from "@/lib/meal-ingredients";
import { parseMealItems } from "@/lib/meal-templates";

type SavedItem = MealTemplateItem & { nutrition: NonNullable<MealTemplateItem["nutrition"]> };

/**
 * The meal's ingredients, each with its own saved figures, so every one
 * slides without asking the estimator again. A weighed item slides in grams;
 * a counted one, "2 eggs" or "250ml 2% milk", by how many. Slid to zero, an
 * item is left out of the meal and kept as an option.
 */
export function IngredientWeights({
  items,
  canAdd,
  adding,
  error,
  onAmount,
  onRemove,
  onAdd,
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
      {items.map((item, index) => {
        const weighed = item.nutrition.grams > 0;
        const label = weighed ? item.name : countOf(item.name).base;
        const amount = amountOf(item);
        const reference = weighed ? item.nutrition.grams : item.nutrition.count ?? amount;
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <p className={`min-w-0 flex-1 truncate text-xs ${amount > 0 ? "" : "text-muted-foreground"}`}>
                {label}
              </p>
              {/* The last one stays: a meal with no ingredients has nothing to slide. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${label}`}
                disabled={items.length < 2}
                onClick={() => onRemove(index)}
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
                onChange={(event) => onAmount(index, event.target.valueAsNumber)}
              />
              <Input
                type="number"
                inputMode="decimal"
                aria-label={weighed ? `${label} grams` : `How many ${label}`}
                min={0}
                max={weighed ? MEAL_TEMPLATE_GRAMS_LIMIT : 1000}
                step={weighed ? 0.1 : 0.25}
                value={amount}
                onChange={(event) => onAmount(index, event.target.value === "" ? 0 : event.target.valueAsNumber)}
              />
              <span aria-hidden="true" className="text-xs text-muted-foreground">{weighed ? "g" : "×"}</span>
            </div>
          </div>
        );
      })}
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
            Slide one to 0 to leave it out and keep it as an option. Added ones are estimated once. Update the template to keep changes.
          </p>
          {shown ? <p role="alert" className="text-xs text-destructive">{shown}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
