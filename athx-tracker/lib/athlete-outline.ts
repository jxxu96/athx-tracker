/** Who a meal or session box is outlined for. "both" is the split ring. */
export type AthleteOutline = "hippos" | "gators" | "both";

/**
 * Attributes globals.css uses to draw that outline. The fill matches the
 * surface the box already had: a card, the muted editing banner, a pressed
 * choice, or the header pill.
 */
export function athleteOutline(
  who: AthleteOutline,
  fill?: "muted" | "accent" | "background",
) {
  return {
    "data-athlete-outline": who,
    ...(fill ? { "data-athlete-fill": fill } : {}),
  };
}
