// Runners
export { default as BenchmarkRunner } from './runners/BenchmarkRunner.js';
export type { BenchmarkRunnerOptions, BenchmarkResult, PhaseResult } from './runners/BenchmarkRunner.js';

export { loadScenario, parseDuration } from './runners/ScenarioLoader.js';
export type { Scenario, ScenarioPhase, ScenarioAction, ScenarioThresholds } from './runners/ScenarioLoader.js';

export { default as MetricCollector } from './runners/MetricCollector.js';
export type { CollectedMetrics, ServerSnapshot, ClientSnapshot, TickReportEntry, SpikeEntry, OperationSnapshot } from './runners/MetricCollector.js';

export { default as HeadlessClient } from './runners/HeadlessClient.js';
export type { HeadlessClientOptions } from './runners/HeadlessClient.js';

export { default as BaselineComparer } from './runners/BaselineComparer.js';
export type { BaselineResult, ComparisonEntry, ComparisonResult, BaselineComparerOptions } from './runners/BaselineComparer.js';

// Reporters
export { default as ConsoleReporter } from './reporters/ConsoleReporter.js';
export { default as JsonReporter } from './reporters/JsonReporter.js';
export type { JsonReport } from './reporters/JsonReporter.js';

// Analysis (re-exported when available)
export { default as TraceParser } from './analysis/TraceParser.js';
export type { TraceEvent, FrameTiming, LongTask, GcEvent, TraceAnalysis } from './analysis/TraceParser.js';

export { default as CpuProfileAnalyzer } from './analysis/CpuProfileAnalyzer.js';
export type { ProfileNode, HotFunction, CallTreeNode, CpuProfileAnalysis } from './analysis/CpuProfileAnalyzer.js';

export { default as SpikeCorrelator } from './analysis/SpikeCorrelator.js';
export type { SpikeCorrelation, SpikeCause } from './analysis/SpikeCorrelator.js';

export { default as NoiseFilter } from './analysis/NoiseFilter.js';
export type { ChangePoint, VarianceClassification } from './analysis/NoiseFilter.js';
