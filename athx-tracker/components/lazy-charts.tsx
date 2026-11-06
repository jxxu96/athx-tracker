"use client";

import dynamic from "next/dynamic";
import { Component, type ComponentProps, type ReactNode } from "react";
import type {
  BodyweightChart as BodyweightChartType,
  LiftChart as LiftChartType,
  ProteinChart as ProteinChartType,
} from "@/components/trend-charts";

/*
 * The charts come in a file of their own, fetched the first time Progress
 * draws one. The chart library alone added a third to the code every phone
 * downloads after each deploy, and Today, where the app opens, has no chart.
 * Once fetched online, the service worker keeps the file like any other
 * built file, so the charts open offline after that.
 */
const charts = () => import("@/components/trend-charts");

const Bodyweight = dynamic(() => charts().then((module) => module.BodyweightChart), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-32" />,
});
const Lift = dynamic(() => charts().then((module) => module.LiftChart), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-32" />,
});
const Protein = dynamic(() => charts().then((module) => module.ProteinChart), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-32" />,
});

/**
 * A chart whose file cannot be fetched, offline before it ever was or after a
 * deploy replaced it, leaves its place empty rather than taking Progress down.
 * The figures written above each chart do not depend on it.
 */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Each chart draws nothing below two points; checked here as well, so a chart
// with nothing to draw holds no space while its file loads.

export function BodyweightChart(props: ComponentProps<typeof BodyweightChartType>) {
  if (props.weighIns.length < 2) return null;
  return (
    <ChartBoundary>
      <Bodyweight {...props} />
    </ChartBoundary>
  );
}

export function LiftChart(props: ComponentProps<typeof LiftChartType>) {
  if (props.history.length < 2) return null;
  return (
    <ChartBoundary>
      <Lift {...props} />
    </ChartBoundary>
  );
}

export function ProteinChart(props: ComponentProps<typeof ProteinChartType>) {
  if (!props.weeks.some((week) => week.target > 0 && week.days > 0)) return null;
  return (
    <ChartBoundary>
      <Protein {...props} />
    </ChartBoundary>
  );
}
