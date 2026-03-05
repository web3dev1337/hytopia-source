export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export interface FrameTiming {
  startMs: number;
  durationMs: number;
  scriptMs: number;
  layoutMs: number;
  paintMs: number;
}

export interface LongTask {
  startMs: number;
  durationMs: number;
  name: string;
  category: string;
}

export interface GcEvent {
  startMs: number;
  durationMs: number;
  type: string;
  sizeBeforeBytes?: number;
  sizeAfterBytes?: number;
}

export interface TraceAnalysis {
  totalDurationMs: number;
  frameCount: number;
  avgFrameTimeMs: number;
  p95FrameTimeMs: number;
  jankFrames: number;
  longTasks: LongTask[];
  gcEvents: GcEvent[];
  frameTimes: number[];
  userTimings: { name: string; startMs: number; durationMs: number }[];
}

export default class TraceParser {
  public parse(traceData: { traceEvents: TraceEvent[] } | TraceEvent[]): TraceAnalysis {
    const events = Array.isArray(traceData) ? traceData : traceData.traceEvents;

    if (!events || events.length === 0) {
      return this._emptyAnalysis();
    }

    const minTs = Math.min(...events.filter(e => e.ts > 0).map(e => e.ts));

    const frameTimes = this._extractFrameTimes(events, minTs);
    const longTasks = this._extractLongTasks(events, minTs);
    const gcEvents = this._extractGcEvents(events, minTs);
    const userTimings = this._extractUserTimings(events, minTs);

    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const jankThresholdMs = 1000 / 30;

    return {
      totalDurationMs: events.length > 0
        ? (Math.max(...events.map(e => e.ts + (e.dur ?? 0))) - minTs) / 1000
        : 0,
      frameCount: frameTimes.length,
      avgFrameTimeMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
      p95FrameTimeMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      jankFrames: frameTimes.filter(t => t > jankThresholdMs).length,
      longTasks,
      gcEvents,
      frameTimes,
      userTimings,
    };
  }

  private _extractFrameTimes(events: TraceEvent[], minTs: number): number[] {
    const compositorFrames = events.filter(
      e => e.name === 'Compositor::BeginFrame' || e.name === 'BeginFrame',
    );

    if (compositorFrames.length < 2) {
      const mainFrames = events.filter(e => e.name === 'BeginMainThreadFrame');

      if (mainFrames.length < 2) return [];

      const times: number[] = [];

      for (let i = 1; i < mainFrames.length; i++) {
        times.push((mainFrames[i].ts - mainFrames[i - 1].ts) / 1000);
      }

      return times;
    }

    const times: number[] = [];

    for (let i = 1; i < compositorFrames.length; i++) {
      times.push((compositorFrames[i].ts - compositorFrames[i - 1].ts) / 1000);
    }

    return times;
  }

  private _extractLongTasks(events: TraceEvent[], minTs: number): LongTask[] {
    const longTaskThresholdUs = 50000;

    return events
      .filter(e => e.ph === 'X' && (e.dur ?? 0) > longTaskThresholdUs)
      .map(e => ({
        startMs: (e.ts - minTs) / 1000,
        durationMs: (e.dur ?? 0) / 1000,
        name: e.name,
        category: e.cat,
      }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 100);
  }

  private _extractGcEvents(events: TraceEvent[], minTs: number): GcEvent[] {
    const gcNames = ['V8.GCScavenger', 'V8.GCFinalizeMC', 'V8.GCIncrementalMarking', 'MinorGC', 'MajorGC', 'BlinkGC.AtomicPhase'];

    return events
      .filter(e => gcNames.some(n => e.name.includes(n)) && e.ph === 'X')
      .map(e => ({
        startMs: (e.ts - minTs) / 1000,
        durationMs: (e.dur ?? 0) / 1000,
        type: e.name,
        sizeBeforeBytes: e.args?.usedHeapSizeBefore as number | undefined,
        sizeAfterBytes: e.args?.usedHeapSizeAfter as number | undefined,
      }));
  }

  private _extractUserTimings(events: TraceEvent[], minTs: number): { name: string; startMs: number; durationMs: number }[] {
    return events
      .filter(e => e.cat === 'blink.user_timing' && e.ph === 'X')
      .map(e => ({
        name: e.name,
        startMs: (e.ts - minTs) / 1000,
        durationMs: (e.dur ?? 0) / 1000,
      }));
  }

  private _emptyAnalysis(): TraceAnalysis {
    return {
      totalDurationMs: 0,
      frameCount: 0,
      avgFrameTimeMs: 0,
      p95FrameTimeMs: 0,
      jankFrames: 0,
      longTasks: [],
      gcEvents: [],
      frameTimes: [],
      userTimings: [],
    };
  }
}
