"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/workout-form";
import { MEAL_TEMPLATE_ITEM_LIMIT, MEAL_TEMPLATE_ITEMS } from "@/lib/domain";
import { ingredientSliderMax } from "@/lib/meal-ingredients";
import { setItemFigure, setItemGrams, type ItemBox, type ItemDraft } from "@/lib/meal-items";

/** The same boxes, in the same places, as a meal's: three across, then fiber and fat. */
const FIGURES = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "protein", label: "Protein (g)" },
  { key: "carbs", label: "Carbs (g)" },
  { key: "fiber", label: "Fiber (g)" },
  { key: "fat", label: "Fat (g)" },
] as const satisfies readonly { key: ItemBox; label: string }[];

function ItemCard({
  item,
  index,
  ethanol,
  removable,
  onItem,
  onRename,
  onAnchor,
  onRemove,
}: {
  item: ItemDraft;
  index: number;
  /** The meal holds ethanol, or is an Alcohol sitting, so each item has a box for it. */
  ethanol: boolean;
  /** The last item stays: Collapse is the way back to one meal. */
  removable: boolean;
  /** A figure or the grams changed, which changes the meal's figures. */
  onItem: (change: (item: ItemDraft) => ItemDraft) => void;
  onRename: (name: string) => void;
  /** The grams box was left, which ties the figures to that weight and changes nothing. */
  onAnchor: () => void;
  onRemove: () => void;
}) {
  const label = `Item ${index + 1}`;
  const named = item.name.trim() || `item ${index + 1}`;
  const grams = Number(item.grams);
  // A slider only where moving it scales something: a weighed item.
  const slides = item.per !== null && Number.isFinite(grams) && grams >= 0;
  return (
    <div role="group" aria-label={label} className="space-y-3 rounded-xl border p-3">
      <div className="flex items-end gap-2">
        <Field label="Item" className="min-w-0 flex-1">
          <Input
            value={item.name}
            maxLength={MEAL_TEMPLATE_ITEM_LIMIT}
            placeholder="Chicken breast"
            onChange={(event) => onRename(event.target.value)}
          />
        </Field>
        <Field label="Grams" className="w-20 shrink-0">
          <Input
            value={item.grams}
            inputMode="decimal"
            placeholder="–"
            onChange={(event) => {
              const text = event.target.value;
              onItem((current) => setItemGrams(current, text));
            }}
            onBlur={onAnchor}
          />
        </Field>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mb-1 shrink-0 text-muted-foreground"
          aria-label={`Remove ${named}`}
          disabled={!removable}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      {slides ? (
        <input
          type="range"
          className="w-full accent-primary"
          aria-label={`${named} weight`}
          aria-valuetext={`${item.grams || 0} g`}
          min={0}
          max={ingredientSliderMax(grams, item.per!.grams)}
          step={0.1}
          value={grams}
          onChange={(event) => {
            const text = String(event.target.valueAsNumber);
            onItem((current) => setItemGrams(current, text));
          }}
        />
      ) : null}
      {ethanol ? (
        <Field label="Ethanol (g)">
          <Input
            value={item.ethanol}
            inputMode="decimal"
            placeholder="0"
            onChange={(event) => {
              const text = event.target.value;
              onItem((current) => setItemFigure(current, "ethanol", text));
            }}
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        {FIGURES.map(({ key, label: name }) => (
          <Field key={key} label={name}>
            <Input
              value={item[key]}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => {
                const text = event.target.value;
                onItem((current) => setItemFigure(current, key, text));
              }}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/**
 * The meal as the items it was made of, each with its own figures, and its
 * grams when it was weighed, which move the figures with them. The meal's
 * figures above are these added up.
 */
export function MealItems({
  items,
  ethanol,
  onItem,
  onRename,
  onAnchor,
  onRemove,
  onAdd,
}: {
  items: ItemDraft[];
  /** Show each item's ethanol box: the meal holds ethanol, or is an Alcohol sitting. */
  ethanol: boolean;
  onItem: (id: string, change: (item: ItemDraft) => ItemDraft) => void;
  onRename: (id: string, name: string) => void;
  onAnchor: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {items.map((item, index) => (
        <ItemCard
          key={item.id}
          item={item}
          index={index}
          ethanol={ethanol}
          removable={items.length > 1}
          onItem={(change) => onItem(item.id, change)}
          onRename={(name) => onRename(item.id, name)}
          onAnchor={() => onAnchor(item.id)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={items.length >= MEAL_TEMPLATE_ITEMS}
        onClick={onAdd}
      >
        <Plus />
        Add item
      </Button>
    </>
  );
}
