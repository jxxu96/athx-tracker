"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/workout-form";
import { athleteOutline, type AthleteOutline } from "@/lib/athlete-outline";
import { ATHLETES, MEAL_TEMPLATE_GRAMS_LIMIT, MEAL_TEMPLATE_ITEMS } from "@/lib/domain";
import type { Meal, MealTemplateItem } from "@/lib/domain";
import { api, message, newId } from "@/lib/client";
import { mealKey } from "@/lib/common-meals";
import type { MealEstimate } from "@/lib/estimate-conversation";
import {
  buildTemplate,
  formatGrams,
  mealOffers,
  removeTemplate,
  templateDescription,
  upsertTemplate,
  type MealOffer,
  type MealTemplates,
} from "@/lib/meal-templates";

const SITTINGS = ["Breakfast", "Lunch", "Dinner", "Snack", "Alcohol"] as const;

type ItemDraft = { name: string; grams: string };

type Draft = {
  id: string;
  name: string;
  meal: Meal["meal"];
  items: ItemDraft[];
  macros: Meal["macros"];
  assumptions: string;
  sourceKey: string;
  saved: boolean;
};

function storedTemplates(templates: MealTemplates | undefined): MealTemplates {
  return {
    hippos: templates?.hippos ?? [],
    gators: templates?.gators ?? [],
  };
}

function readItems(rows: ItemDraft[]): { items: MealTemplateItem[] } | { error: string } {
  const items: MealTemplateItem[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const raw = row.grams.trim();
    if (!name && raw === "") continue;
    if (!name) return { error: "Name each item." };
    const grams = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(grams) || grams < 0 || grams > MEAL_TEMPLATE_GRAMS_LIMIT)
      return { error: "Grams need a number from 0 up to 5000." };
    items.push({ name, grams });
  }
  if (!items.length) return { error: "Add at least one item." };
  if (items.length > MEAL_TEMPLATE_ITEMS) return { error: "That meal has too many items." };
  return { items };
}

function macroLine(macros: Meal["macros"], meal: Meal["meal"]) {
  return [
    `${Math.round(macros.calories)} kcal`,
    `${Math.round(macros.protein)} g protein`,
    `${Math.round(macros.carbs)} g carbs`,
    `${Math.round(macros.fat)} g fat`,
    ...(macros.fiber ? [`${Math.round(macros.fiber)} g fiber`] : []),
    ...(meal === "Alcohol" && macros.alcohol ? [`${Math.round(macros.alcohol)} g ethanol`] : []),
  ].join(" · ");
}

export function MealTemplateList({
  loggingFor,
  templates,
  meals,
  today,
  grokReady,
  disabled,
  showOffers,
  formLabel,
  onApply,
  onSaveForm,
  onSaveTemplates,
}: {
  loggingFor: AthleteOutline;
  templates: MealTemplates | undefined;
  meals: Meal[];
  today: string;
  grokReady: boolean;
  disabled: boolean;
  showOffers: boolean;
  formLabel: string;
  onApply: (athlete: "hippos" | "gators", offer: MealOffer) => void;
  onSaveForm: () => void;
  onSaveTemplates: (next: MealTemplates, notice: string) => Promise<void>;
}) {
  const stored = storedTemplates(templates);
  const [editor, setEditor] = useState<{ athlete: "hippos" | "gators"; draft: Draft } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [listError, setListError] = useState("");
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const sides = loggingFor === "both"
    ? (["hippos", "gators"] as const)
    : ([loggingFor] as const);
  const groups = showOffers
    ? sides
        .map((athlete) => ({
          athlete,
          offers: mealOffers(
            stored[athlete],
            meals.filter((meal) => meal.athlete === athlete),
            today,
          ),
        }))
        .filter((group) => group.offers.length > 0)
    : [];

  function openEditor(athlete: "hippos" | "gators", offer: MealOffer) {
    setListError("");
    setEditorError("");
    setEditor({
      athlete,
      draft: {
        id: offer.saved ? offer.id : newId(),
        name: offer.name,
        meal: offer.meal,
        items: (offer.items.length ? offer.items : [{ name: offer.name, grams: 0 }]).map((item) => ({
          name: item.name,
          grams: formatGrams(item.grams),
        })),
        macros: offer.macros,
        assumptions: offer.assumptions,
        sourceKey: offer.sourceKey || mealKey(offer.name),
        saved: offer.saved,
      },
    });
  }

  async function pin(athlete: "hippos" | "gators", offer: MealOffer) {
    const built = buildTemplate({
      id: newId(),
      name: offer.name,
      meal: offer.meal,
      items: offer.items,
      macros: offer.macros,
      assumptions: offer.assumptions,
      sourceKey: offer.sourceKey,
    });
    if (!built.ok) {
      setListError(built.error);
      return;
    }
    const written = upsertTemplate(stored[athlete], built.template);
    if (!written.ok) {
      setListError(written.error);
      return;
    }
    setSaving(true);
    setListError("");
    try {
      await onSaveTemplates({ ...stored, [athlete]: written.templates }, "Template saved");
    } catch (problem) {
      setListError(message(problem));
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor() {
    if (!editor || saving || estimating) return;
    const read = readItems(editor.draft.items);
    if ("error" in read) {
      setEditorError(read.error);
      return;
    }
    const built = buildTemplate({
      id: editor.draft.id,
      name: editor.draft.name,
      meal: editor.draft.meal,
      items: read.items,
      macros: editor.draft.macros,
      assumptions: editor.draft.assumptions,
      sourceKey: editor.draft.sourceKey,
    });
    if (!built.ok) {
      setEditorError(built.error);
      return;
    }
    const written = upsertTemplate(stored[editor.athlete], built.template);
    if (!written.ok) {
      setEditorError(written.error);
      return;
    }
    setSaving(true);
    setEditorError("");
    try {
      await onSaveTemplates(
        { ...stored, [editor.athlete]: written.templates },
        editor.draft.saved ? "Template updated" : "Template saved",
      );
      setEditor(null);
    } catch (problem) {
      setEditorError(message(problem));
    } finally {
      setSaving(false);
    }
  }

  async function removeEditor() {
    if (!editor?.draft.saved || saving) return;
    setSaving(true);
    setEditorError("");
    try {
      await onSaveTemplates(
        {
          ...stored,
          [editor.athlete]: removeTemplate(stored[editor.athlete], editor.draft.id),
        },
        "Template removed",
      );
      setEditor(null);
    } catch (problem) {
      setEditorError(message(problem));
    } finally {
      setSaving(false);
    }
  }

  async function estimateItems() {
    if (!editor || estimating || saving) return;
    const read = readItems(editor.draft.items);
    if ("error" in read) {
      setEditorError(read.error);
      return;
    }
    const description = templateDescription(read.items);
    if (description.trim().length < 3) {
      setEditorError("Add an item before estimating.");
      return;
    }
    setEstimating(true);
    setEditorError("");
    try {
      const { estimate } = await api<{ estimate: MealEstimate }>("/api/estimate", {
        method: "POST",
        body: JSON.stringify({ description }),
      });
      setEditor((current) => {
        if (!current) return current;
        return {
          ...current,
          draft: {
            ...current.draft,
            meal: (estimate.alcohol ?? 0) > 0 ? "Alcohol" : current.draft.meal,
            macros: {
              calories: estimate.calories,
              protein: estimate.protein,
              carbs: estimate.carbs,
              fat: estimate.fat,
              alcohol: estimate.alcohol ?? 0,
              fiber: estimate.fiber ?? 0,
            },
            assumptions: estimate.assumptions,
          },
        };
      });
    } catch (problem) {
      setEditorError(message(problem));
    } finally {
      setEstimating(false);
    }
  }

  function updateDraft(patch: Partial<Draft>) {
    setEditor((current) => current && { ...current, draft: { ...current.draft, ...patch } });
    setEditorError("");
  }

  const preview = editor
    ? templateDescription(editor.draft.items.map((item) => ({
        name: item.name,
        grams: Number(item.grams) || 0,
      })))
    : "";

  return (
    <section
      {...athleteOutline(loggingFor)}
      className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold">Meal templates</h3>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || saving || estimating}
        onClick={onSaveForm}
      >
        {formLabel}
      </Button>
      {listError ? (
        <p role="alert" className="text-sm text-destructive">{listError}</p>
      ) : null}
      {groups.map((group) => (
        <div key={group.athlete} className="space-y-1.5">
          {groups.length > 1 ? (
            <p className="text-xs font-medium" style={{ color: ATHLETES[group.athlete].ink }}>
              {ATHLETES[group.athlete].name}
            </p>
          ) : null}
          {group.offers.map((offer) => {
            const summary = templateDescription(offer.items);
            return (
              <div key={offer.id} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  aria-label={`${ATHLETES[group.athlete].name}: ${offer.name}`}
                  disabled={disabled || saving || estimating}
                  onClick={() => onApply(group.athlete, offer)}
                  className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-left text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <span className="block truncate">{offer.name}</span>
                  <span className="block truncate text-[10px] font-normal text-muted-foreground">
                    {offer.meal}
                    {summary ? ` · ${summary}` : ""}
                    {offer.saved ? "" : " · from your log"}
                  </span>
                </button>
                {offer.saved ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto shrink-0 px-3"
                    disabled={disabled || saving || estimating}
                    aria-label={`Edit ${offer.name}`}
                    onClick={() => openEditor(group.athlete, offer)}
                  >
                    Edit
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto shrink-0 px-3"
                    disabled={disabled || saving || estimating}
                    aria-label={`Save ${offer.name} as a template`}
                    onClick={() => void pin(group.athlete, offer)}
                  >
                    Save
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving && !estimating) setEditor(null);
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-hidden p-4 sm:p-6">
          {editor ? (
            <>
              <DialogHeader className="shrink-0 pr-6 text-left">
                <DialogTitle>Edit {ATHLETES[editor.athlete].name} template</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
                <Field label="Template name">
                  <Input
                    value={editor.draft.name}
                    maxLength={80}
                    disabled={saving || estimating}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                  />
                </Field>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sitting</p>
                  <div role="group" aria-label="Template sitting" className="flex flex-wrap gap-1.5">
                    {SITTINGS.map((sitting) => (
                      <button
                        key={sitting}
                        type="button"
                        aria-pressed={editor.draft.meal === sitting}
                        disabled={saving || estimating}
                        onClick={() => updateDraft({ meal: sitting })}
                        className="rounded-lg border px-2 py-2 text-xs font-medium aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                      >
                        {sitting}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[5.5rem_1fr_auto] gap-1.5 text-[11px] text-muted-foreground">
                    <span>Grams</span>
                    <span>Item</span>
                    <span className="sr-only">Remove</span>
                  </div>
                  {editor.draft.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-[5.5rem_1fr_auto] gap-1.5">
                      <Input
                        aria-label={`Grams, item ${index + 1}`}
                        inputMode="decimal"
                        placeholder="grams"
                        value={item.grams}
                        disabled={saving || estimating}
                        onChange={(event) => {
                          const items = editor.draft.items.slice();
                          items[index] = { ...item, grams: event.target.value };
                          updateDraft({ items });
                        }}
                      />
                      <Input
                        aria-label={`Item ${index + 1}`}
                        value={item.name}
                        maxLength={80}
                        placeholder="oats"
                        disabled={saving || estimating}
                        onChange={(event) => {
                          const items = editor.draft.items.slice();
                          items[index] = { ...item, name: event.target.value };
                          updateDraft({ items });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove item ${index + 1}`}
                        disabled={saving || estimating}
                        onClick={() => {
                          const items = editor.draft.items.filter((_, itemIndex) => itemIndex !== index);
                          updateDraft({ items: items.length ? items : [{ name: "", grams: "" }] });
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || estimating || editor.draft.items.length >= MEAL_TEMPLATE_ITEMS}
                    onClick={() => updateDraft({
                      items: [...editor.draft.items, { name: "", grams: "" }],
                    })}
                  >
                    Add item
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{macroLine(editor.draft.macros, editor.draft.meal)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Changing the grams does not change these figures. Estimate again
                  when you want the macros to follow the new portions.
                </p>
                {grokReady ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={estimating || saving || preview.trim().length < 3}
                    onClick={() => void estimateItems()}
                  >
                    <Sparkles />
                    {estimating ? "Estimating…" : "Estimate these items"}
                  </Button>
                ) : null}
                {editorError ? (
                  <p role="alert" className="text-sm text-destructive">{editorError}</p>
                ) : null}
                {editor.draft.saved ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-destructive"
                    disabled={saving || estimating}
                    onClick={() => void removeEditor()}
                  >
                    Delete template
                  </Button>
                ) : null}
              </div>
              <DialogFooter className="shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || estimating}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving || estimating}
                  onClick={() => void saveEditor()}
                >
                  {saving ? "Saving…" : "Save template"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
