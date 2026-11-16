"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEM_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  type MealTemplateItem,
} from "@/lib/domain";
import { ingredientSliderMax } from "@/lib/meal-ingredients";
import { formatGrams } from "@/lib/meal-templates";

type SavedItem = MealTemplateItem & { nutrition: NonNullable<MealTemplateItem["nutrition"]> };

/**
 * The meal's ingredients, each with its own saved figures, so a portion
 * slides and an option turns on or off without asking the estimator again.
 * A counted item, "2 eggs", has no weight to slide, only a switch.
 */
export function IngredientWeights({
  items,
  canAdd,
  adding,
  error,
  onGrams,
  onToggle,
  onAdd,
}: {
  items: SavedItem[];
  /** An added ingredient is estimated on its own, so this needs the estimator. */
  canAdd: boolean;
  adding: boolean;
  error: string;
  onGrams: (index: number, grams: number) => void;
  onToggle: (index: number, on: boolean) => void;
  /** Resolves true once the ingredient is on the meal, so the boxes can clear. */
  onAdd: (item: MealTemplateItem) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [grams, setGrams] = useState("");
  const [problem, setProblem] = useState("");
  const full = items.length >= MEAL_TEMPLATE_ITEMS;

  async function add() {
    if (adding || full) return;
    const food = name.trim();
    const amount = grams.trim() === "" ? 0 : Number(grams);
    if (!food) return setProblem("Name the ingredient.");
    if (!Number.isFinite(amount) || amount < 0 || amount > MEAL_TEMPLATE_GRAMS_LIMIT)
      return setProblem("Grams need a number from 0 up to 5000.");
    setProblem("");
    if (await onAdd({ name: food, grams: Math.round(amount * 10) / 10 })) {
      setName("");
      setGrams("");
    }
  }

  const shown = problem || error;

  return (
    <fieldset className="space-y-2 rounded-xl border p-3">
      <legend className="px-1 text-xs font-medium">Ingredient weights</legend>
      {items.map((item, index) => {
        const on = !item.off;
        const weighed = item.nutrition.grams > 0;
        const box = `${id}-${index}`;
        return (
          <div key={index} className="grid grid-cols-[1fr_5rem] items-center gap-x-3 gap-y-1">
            <div className="col-span-2 flex min-w-0 items-center gap-2">
              <Checkbox
                id={box}
                checked={on}
                aria-label={`Include ${item.name}`}
                onCheckedChange={(value) => onToggle(index, value === true)}
              />
              <label
                htmlFor={box}
                className={`min-w-0 flex-1 truncate text-xs ${on ? "" : "text-muted-foreground"}`}
              >
                {item.name}
              </label>
              {/* An option that is off keeps its portion for when it is turned on. */}
              {!on && weighed ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatGrams(item.grams) || "0"} g
                </span>
              ) : null}
            </div>
            {on && weighed ? (
              <>
                <input
                  type="range"
                  className="w-full accent-primary"
                  aria-label={`${item.name} weight`}
                  aria-valuetext={`${item.grams} g`}
                  min={0}
                  max={ingredientSliderMax(item.grams, item.nutrition.grams)}
                  step={0.1}
                  value={item.grams}
                  onChange={(event) => onGrams(index, event.target.valueAsNumber)}
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  aria-label={`${item.name} grams`}
                  min={0}
                  max={MEAL_TEMPLATE_GRAMS_LIMIT}
                  step={0.1}
                  value={item.grams}
                  onChange={(event) => onGrams(index, event.target.value === "" ? 0 : event.target.valueAsNumber)}
                />
              </>
            ) : null}
          </div>
        );
      })}
      {canAdd ? (
        <div className="space-y-1.5 border-t pt-2">
          <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-1.5">
            <Input
              aria-label="New ingredient grams"
              inputMode="decimal"
              placeholder="grams"
              value={grams}
              disabled={adding || full}
              onChange={(event) => {
                setGrams(event.target.value);
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
            <Input
              aria-label="New ingredient"
              placeholder={full ? "No room for more" : "Ingredient"}
              maxLength={MEAL_TEMPLATE_ITEM_LIMIT}
              value={name}
              disabled={adding || full}
              onChange={(event) => {
                setName(event.target.value);
                setProblem("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={adding || full || !name.trim()}
              onClick={() => void add()}
            >
              <Plus />
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Added ones are estimated once. Untick one to keep it as an option; update the template to save it.
          </p>
          {shown ? <p role="alert" className="text-xs text-destructive">{shown}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
