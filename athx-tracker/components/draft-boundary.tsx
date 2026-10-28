"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * A form that fails to draw takes only itself down, not the app around it.
 * Opening a draft is the likely cause: one saved by an older version of the
 * form, or damaged in storage, could hold something the form cannot show, and
 * since it opens again every time, it would fail every time. onError sets the
 * draft aside; the button starts the form afresh.
 */
export class DraftBoundary extends Component<
  { children: ReactNode; onError: () => void; onReset: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl border bg-card p-6 text-center">
        <p className="text-sm font-medium">This form could not be opened.</p>
        <Button className="mt-4" variant="outline" onClick={this.props.onReset}>
          Start afresh
        </Button>
      </div>
    );
  }
}
