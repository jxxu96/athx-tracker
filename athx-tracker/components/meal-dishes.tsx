"use client";

import { useId, useState } from "react";
import { ChevronsUpDown, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/workout-form";
import { ATHLETES, ESTIMATORS } from "@/lib/domain";
import {
  ASSUMPTIONS_LIMIT,
  DISH_LIMIT,
  DISH_TEXT_LIMIT,
  EATERS,
  QUANTITY_LIMIT,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_SLIDER,
  closeScale,
  looseDishes,
  openScale,
  portionOf,
  readQuantity,
  readScale,
  scaleDish,
  setFigure,
  setShare,
  shareTotals,
  slideShare,
  sliderSteps,
  sliderValue,
  takeWrittenShare,
  tidyShare,
  type DishDraft,
  type Eater,
} from "@/lib/meal-dishes";
import { dishItemCheck, expandDish } from "@/lib/meal-items";

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
  disabled,
  onDish,
}: {
  dish: DishDraft;
  disabled: boolean;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
}) {
  const ids = { hippos: useId(), gators: useId() };
  const [read] = looseDishes([dish]);
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

/** A percentage as the size box shows it: to a tenth. */
const shownPercent = (percent: number) => String(Math.round(percent * 10) / 10);

/**
 * The size box. It shows the size the dish is at, and while it is typed
 * into, what is typed: a size it can take applies at once, so the figures
 * follow the typing, and one it cannot is said under it and dropped on
 * leaving the box.
 */
function SizeBox({
  percent,
  disabled,
  onPercent,
}: {
  percent: number;
  disabled: boolean;
  onPercent: (percent: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const unreadable = typed !== null && typed.trim() !== "" && readScale(typed) === null;
  return (
    <div className="w-20 shrink-0 space-y-1">
      <div className="relative">
        <Input
          aria-label="Size (%)"
          value={typed ?? shownPercent(percent)}
          inputMode="decimal"
          disabled={disabled}
          aria-invalid={unreadable || undefined}
          className="h-9 pr-5 pl-1.5 text-right tabular-nums"
          onFocus={() => setTyped(shownPercent(percent))}
          onBlur={() => setTyped(null)}
          onChange={(event) => {
            const text = event.target.value;
            setTyped(text);
            const value = readScale(text);
            if (value !== null) onPercent(value);
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground"
        >
          %
        </span>
      </div>
      {unreadable ? (
        <p className="text-[11px] text-muted-foreground">
          {SCALE_MIN}% to {SCALE_MAX}%
        </p>
      ) : null}
    </div>
  );
}

/**
 * Makes the dish bigger or smaller than its figures say, by a percentage.
 * Ticked, it opens at 100% with a slider and a box, and the figures above
 * follow the size. Unticked, the figures go back to 100%.
 */
function ScaleControl({
  dish,
  disabled,
  onDish,
}: {
  dish: DishDraft;
  disabled: boolean;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
}) {
  const scale = dish.scale;
  const full = scale ? Math.round(scale.base.calories * 10) / 10 : 0;
  return (
    <div className="space-y-2">
      <label className="flex w-fit items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={scale !== null}
          disabled={disabled}
          className="size-4 shrink-0 accent-primary"
          onChange={(event) => {
            const on = event.target.checked;
            onDish((current) => (on ? openScale(current) : closeScale(current)));
          }}
        />
        Scale size
      </label>
      {scale ? (
        <div className="space-y-1">
          <div className="flex items-start gap-3">
            <input
              type="range"
              className="h-9 min-w-0 flex-1 accent-primary"
              aria-label="Size"
              aria-valuetext={`${shownPercent(scale.percent)}%`}
              min={SCALE_SLIDER.min}
              max={SCALE_SLIDER.max}
              step={SCALE_SLIDER.step}
              value={Math.min(SCALE_SLIDER.max, Math.max(SCALE_SLIDER.min, scale.percent))}
              disabled={disabled}
              onChange={(event) => {
                const percent = event.target.valueAsNumber;
                onDish((current) => scaleDish(current, percent));
              }}
            />
            <SizeBox
              percent={scale.percent}
              disabled={disabled}
              onPercent={(percent) => onDish((current) => scaleDish(current, percent))}
            />
          </div>
          {full > 0 ? <p className="text-[11px] text-muted-foreground">100% is {full} kcal.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Whether the items in the dish's working add up to its calories. Advisory:
 * a gap is said, and one worth a look stands out, but nothing is blocked or
 * changed by it.
 */
function ItemCheck({ dish }: { dish: DishDraft }) {
  const lines = dishItemCheck(dish);
  if (!lines.length) return null;
  return (
    <div role="status" aria-label="Items check" className="space-y-0.5">
      {lines.map((line) => (
        <p
          key={line.text}
          className={`flex items-start gap-1.5 text-xs ${line.off ? "font-medium text-foreground" : "text-muted-foreground"}`}
        >
          {line.off ? <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" /> : null}
          <span>{line.text}</span>
        </p>
      ))}
    </div>
  );
}

function DishCard({
  dish,
  index,
  ethanol,
  grokReady,
  busy,
  disabled,
  error,
  expandable,
  onDish,
  onEstimate,
  onExpand,
  onRemove,
}: {
  dish: DishDraft;
  index: number;
  /** The meal holds ethanol, or is an Alcohol sitting, so each dish has a box for it. */
  ethanol: boolean;
  grokReady: boolean;
  /** This dish is being estimated, so its boxes wait for the answer. */
  busy: boolean;
  /**
   * The whole form is busy, saving. Its fieldset holds the boxes, but the
   * slider is not a form control, so it is told directly.
   */
  disabled: boolean;
  error: string;
  /** How many items the dish's working lists, when they would fit beside the rest. 0 when it lists none. */
  expandable: number;
  onDish: (change: (dish: DishDraft) => DishDraft) => void;
  onEstimate: () => void;
  onExpand: () => void;
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
          // "fries (80% h)": the share goes into the boxes once you leave.
          onBlur={() => {
            if (takeWrittenShare(dish) !== dish) onDish(takeWrittenShare);
          }}
        />
        {grokReady ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={busy || dish.name.trim().length < 3}
            onClick={onEstimate}
          >
            <Sparkles />
            {busy ? "Estimating…" : "Estimate"}
          </Button>
        ) : null}
      </div>
      {ethanol ? (
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
      <ScaleControl dish={dish} disabled={busy || disabled} onDish={onDish} />
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
      <ItemCheck dish={dish} />
      {expandable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy || disabled}
          onClick={onExpand}
        >
          <ChevronsUpDown />
          Expand into {expandable} items
        </Button>
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
      <ShareControl dish={dish} disabled={busy || disabled} onDish={onDish} />
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
  ethanol,
  grokReady,
  estimating,
  disabled,
  errors,
  onDish,
  onEstimate,
  onExpand,
  onRemove,
  onAdd,
}: {
  dishes: DishDraft[];
  /** Show each dish's ethanol box: the meal holds ethanol, or is an Alcohol sitting. */
  ethanol: boolean;
  grokReady: boolean;
  /** The dishes being estimated. Several can be at once. */
  estimating: ReadonlySet<string>;
  /** The form is saving, so nothing on it should change. */
  disabled: boolean;
  errors: Record<string, string>;
  onDish: (id: string, change: (dish: DishDraft) => DishDraft) => void;
  onEstimate: (id: string) => void;
  /** Open a dish up into its items, each a dish with the same share. */
  onExpand: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  // Each item takes the dish's place, so it has the room the dish had.
  const room = DISH_LIMIT - dishes.length + 1;
  const pieces = (dish: DishDraft) => {
    const count = expandDish(dish, () => "").length;
    return count >= 2 && count <= room ? count : 0;
  };
  return (
    <>
      {dishes.map((dish, index) => (
        <DishCard
          key={dish.id}
          dish={dish}
          index={index}
          ethanol={ethanol}
          grokReady={grokReady}
          busy={estimating.has(dish.id)}
          disabled={disabled}
          error={errors[dish.id] ?? ""}
          expandable={pieces(dish)}
          onDish={(change) => onDish(dish.id, change)}
          onEstimate={() => onEstimate(dish.id)}
          onExpand={() => onExpand(dish.id)}
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
  eaters,
}: {
  dishes: DishDraft[];
  eaters: readonly Eater[];
}) {
  const read = looseDishes(dishes);
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
