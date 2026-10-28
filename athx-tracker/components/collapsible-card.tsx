"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Clicking these does its own thing; it should not also fold the box away.
const OWN_CLICK = "a,button,input,select,textarea,label,summary,[role=button],[role=link]";

/**
 * A Today box that folds to a one-line summary when tapped, so the boxes
 * under it come into view. Tapping anywhere that is not a control toggles it;
 * the corner button does the same for a keyboard or screen reader.
 */
export function CollapsibleCard({
  name,
  heading,
  mini,
  className,
  children,
}: {
  /** What the toggle names, as in "Collapse Fuel". */
  name: string;
  /** Shown open or folded, so a folded box still says what it is. */
  heading: React.ReactNode;
  /** The one line a folded box keeps. */
  mini: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      data-collapsed={!open || undefined}
      onClick={(event) => {
        if ((event.target as Element).closest(OWN_CLICK)) return;
        // Selecting text to copy it is not a request to fold the box.
        if (window.getSelection()?.toString()) return;
        setOpen((current) => !current);
      }}
      className={cn("group relative cursor-pointer rounded-2xl border bg-card", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
        onClick={() => setOpen((current) => !current)}
        className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div className="pr-8">{heading}</div>
      {open ? (
        children
      ) : (
        <div className="mt-1 truncate pr-8 text-xs text-muted-foreground">{mini}</div>
      )}
    </section>
  );
}
