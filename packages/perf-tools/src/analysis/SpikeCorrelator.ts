import type { SpikeEntry, TickReportEntry } from '../runners/MetricCollector.js';
import type { GcEvent } from './TraceParser.js';

export interface SpikeCause {
  type: 'entity_spawn' | 'entity_despawn' | 'gc_pause' | 'network_burst' | 'phase_overrun' | 'unknown';
  confidence: number;
  details: string;
}

export interface SpikeCorrelation {
  spike: SpikeEntry;
  causes: SpikeCause[];
  primaryCause: SpikeCause;
}

export default class SpikeCorrelator {
  public correlate(
    spikes: SpikeEntry[],
    tickReports: TickReportEntry[],
    gcEvents?: GcEvent[],
  ): SpikeCorrelation[] {
    return spikes.map(spike => {
      const causes: SpikeCause[] = [];

      const entityCause = this._checkEntityChange(spike, tickReports);

      if (entityCause) causes.push(entityCause);

      const phaseCause = this._checkPhaseOverrun(spike);

      if (phaseCause) causes.push(phaseCause);

      if (gcEvents) {
        const gcCause = this._checkGcPause(spike, gcEvents);

        if (gcCause) causes.push(gcCause);
      }

      if (causes.length === 0) {
        causes.push({
          type: 'unknown',
          confidence: 0.1,
          details: `Spike of ${spike.durationMs.toFixed(1)}ms with no clear correlation`,
        });
      }

      causes.sort((a, b) => b.confidence - a.confidence);

      return {
        spike,
        causes,
        primaryCause: causes[0],
      };
    });
  }

  private _checkEntityChange(spike: SpikeEntry, tickReports: TickReportEntry[]): SpikeCause | null {
    const nearbyReports = tickReports.filter(
      r => Math.abs(r.timestamp - spike.timestamp) < 2000,
    );

    if (nearbyReports.length < 2) return null;

    nearbyReports.sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 1; i < nearbyReports.length; i++) {
      const delta = nearbyReports[i].entityCount - nearbyReports[i - 1].entityCount;

      if (delta > 10) {
        return {
          type: 'entity_spawn',
          confidence: 0.7,
          details: `${delta} entities spawned near spike (${nearbyReports[i - 1].entityCount} -> ${nearbyReports[i].entityCount})`,
        };
      }

      if (delta < -10) {
        return {
          type: 'entity_despawn',
          confidence: 0.5,
          details: `${Math.abs(delta)} entities despawned near spike`,
        };
      }
    }

    return null;
  }

  private _checkPhaseOverrun(spike: SpikeEntry): SpikeCause | null {
    const phases = spike.phases;

    if (!phases || Object.keys(phases).length === 0) return null;

    const entries = Object.entries(phases).sort((a, b) => b[1] - a[1]);
    const topPhase = entries[0];

    if (!topPhase) return null;

    const totalPhaseTime = entries.reduce((s, [, v]) => s + v, 0);
    const topPct = totalPhaseTime > 0 ? (topPhase[1] / totalPhaseTime) * 100 : 0;

    if (topPct > 60) {
      return {
        type: 'phase_overrun',
        confidence: 0.8,
        details: `Phase "${topPhase[0]}" used ${topPct.toFixed(0)}% of tick time (${topPhase[1].toFixed(1)}ms)`,
      };
    }

    return null;
  }

  private _checkGcPause(spike: SpikeEntry, gcEvents: GcEvent[]): SpikeCause | null {
    const spikeTimeMs = spike.timestamp;
    const windowMs = 100;

    const nearbyGc = gcEvents.filter(
      gc => Math.abs(gc.startMs - spikeTimeMs) < windowMs,
    );

    if (nearbyGc.length === 0) return null;

    const totalGcMs = nearbyGc.reduce((s, gc) => s + gc.durationMs, 0);

    if (totalGcMs > 2) {
      return {
        type: 'gc_pause',
        confidence: 0.6,
        details: `${nearbyGc.length} GC event(s) totaling ${totalGcMs.toFixed(1)}ms near spike`,
      };
    }

    return null;
  }
}
