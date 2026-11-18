"use client";

import { BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { athleteOutline } from "@/lib/athlete-outline";
import type { MealTemplateItem } from "@/lib/domain";
import { countOf } from "@/lib/meal-ingredients";

/**
 * At the bottom of a meal filled from a template, once it has foods the
 * template does not: one tap keeps them in it, with the amounts on the form
 * as its defaults (`templateAdditions` in `lib/meal-templates.ts`).
 */
export function TemplateSuggestion({
  athlete,
  templateName,
  additions,
  saving,
  onUpdate,
}: {
  athlete: "hippos" | "gators";
  templateName: string;
  additions: MealTemplateItem[];
  saving: boolean;
  onUpdate: () => void;
}) {
  return (
    <section
      {...athleteOutline(athlete)}
      aria-label="Template suggestion"
      className="space-y-2 rounded-2xl border bg-card p-4"
    >
      <p className="text-xs text-muted-foreground">
        Added {additions.map((item) => countOf(item.name).base).join(", ")}, not in{" "}
        <span className="font-medium text-foreground">{templateName}</span> yet. Updating
        keeps every amount here as its default.
      </p>
      <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={onUpdate}>
        <BookmarkCheck />
        {saving ? "Updating…" : "Update template defaults"}
      </Button>
    </section>
  );
}
