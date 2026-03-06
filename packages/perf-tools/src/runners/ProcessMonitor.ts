import * as fs from 'node:fs';

export interface ProcessSnapshot {
  timestamp: number;
  cpuPct: number;
  rssMb: number;
  threads: number;
  fds: number;
}

export interface ProcessMetrics {
  snapshots: ProcessSnapshot[];
  avgCpuPct: number;
  maxCpuPct: number;
  avgRssMb: number;
  maxRssMb: number;
  maxThreads: number;
  maxFds: number;
}

interface ProcStatSample {
  utime: number;
  stime: number;
  wallMs: number;
}

export default class ProcessMonitor {
  private _pid: number = 0;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _snapshots: ProcessSnapshot[] = [];
  private _lastSamples: Map<number, ProcStatSample> = new Map();
  private _clockTick: number;

  constructor() {
    this._clockTick = 100; // sysconf(_SC_CLK_TCK) default on Linux
  }

  public start(pid: number, intervalMs: number = 1000): void {
    this._pid = pid;
    this._snapshots = [];
    this._lastSamples.clear();

    this._primeBaseline(); // prime the CPU delta baseline

    this._interval = setInterval(() => {
      try {
        const snapshot = this._collect();
        if (snapshot) this._snapshots.push(snapshot);
      } catch {
        // process may have exited
      }
    }, intervalMs);
  }

  public stop(): ProcessMetrics {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    // one final collection
    try {
      const snapshot = this._collect();
      if (snapshot) this._snapshots.push(snapshot);
    } catch {
      // ignore
    }

    return this._summarize();
  }

  /** Discover all PIDs in the process group (leader + children). */
  private _getGroupPids(): number[] {
    const pids: number[] = [];
    try {
      const entries = fs.readdirSync('/proc');
      for (const entry of entries) {
        const pid = parseInt(entry, 10);
        if (isNaN(pid)) continue;
        try {
          const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
          const closeParen = raw.lastIndexOf(')');
          const fields = raw.slice(closeParen + 2).split(' ');
          const pgid = parseInt(fields[2], 10); // pgrp is field index 4 in stat (0-based after comm)
          if (pgid === this._pid) pids.push(pid);
        } catch {
          // process vanished
        }
      }
    } catch {
      // fallback to just the leader
      pids.push(this._pid);
    }
    if (pids.length === 0) pids.push(this._pid);
    return pids;
  }

  private _primeBaseline(): void {
    const pids = this._getGroupPids();
    for (const pid of pids) {
      const sample = this._readProcStat(pid);
      if (sample) this._lastSamples.set(pid, sample);
    }
  }

  private _collect(): ProcessSnapshot | null {
    const pids = this._getGroupPids();
    let totalCpuPct = 0;
    let totalRssKb = 0;
    let totalThreads = 0;
    let totalFds = 0;

    for (const pid of pids) {
      const curSample = this._readProcStat(pid);
      if (!curSample) continue;

      const prevSample = this._lastSamples.get(pid);
      if (prevSample) {
        totalCpuPct += this._calcCpuPct(prevSample, curSample);
      }
      this._lastSamples.set(pid, curSample);

      totalRssKb += this._readRssKb(pid);
      totalThreads += this._readThreadCount(pid);
      totalFds += this._countFds(pid);
    }

    // prune stale PIDs
    for (const pid of this._lastSamples.keys()) {
      if (!pids.includes(pid)) this._lastSamples.delete(pid);
    }

    if (pids.length === 0) return null;

    return {
      timestamp: Date.now(),
      cpuPct: totalCpuPct,
      rssMb: totalRssKb / 1024,
      threads: totalThreads,
      fds: totalFds,
    };
  }

  private _readProcStat(pid: number): ProcStatSample | null {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const closeParen = raw.lastIndexOf(')');
      const fields = raw.slice(closeParen + 2).split(' ');
      // fields[11] = utime, fields[12] = stime (after state, which is fields[0])
      const utime = parseInt(fields[11], 10);
      const stime = parseInt(fields[12], 10);
      return { utime, stime, wallMs: Date.now() };
    } catch {
      return null;
    }
  }

  private _calcCpuPct(prev: ProcStatSample, cur: ProcStatSample): number {
    const wallDeltaS = (cur.wallMs - prev.wallMs) / 1000;
    if (wallDeltaS <= 0) return 0;

    const cpuDeltaTicks = (cur.utime + cur.stime) - (prev.utime + prev.stime);
    const cpuDeltaS = cpuDeltaTicks / this._clockTick;

    return (cpuDeltaS / wallDeltaS) * 100;
  }

  private _readRssKb(pid: number): number {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
      const match = raw.match(/VmRSS:\s+(\d+)\s+kB/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private _readThreadCount(pid: number): number {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
      const match = raw.match(/Threads:\s+(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private _countFds(pid: number): number {
    try {
      return fs.readdirSync(`/proc/${pid}/fd`).length;
    } catch {
      return 0;
    }
  }

  private _summarize(): ProcessMetrics {
    const snapshots = this._snapshots;

    if (snapshots.length === 0) {
      return { snapshots: [], avgCpuPct: 0, maxCpuPct: 0, avgRssMb: 0, maxRssMb: 0, maxThreads: 0, maxFds: 0 };
    }

    return {
      snapshots,
      avgCpuPct: snapshots.reduce((s, v) => s + v.cpuPct, 0) / snapshots.length,
      maxCpuPct: Math.max(...snapshots.map(s => s.cpuPct)),
      avgRssMb: snapshots.reduce((s, v) => s + v.rssMb, 0) / snapshots.length,
      maxRssMb: Math.max(...snapshots.map(s => s.rssMb)),
      maxThreads: Math.max(...snapshots.map(s => s.threads)),
      maxFds: Math.max(...snapshots.map(s => s.fds)),
    };
  }
}
