#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadScenario } from './runners/ScenarioLoader.js';
import BenchmarkRunner from './runners/BenchmarkRunner.js';
import BaselineComparer from './runners/BaselineComparer.js';
import ConsoleReporter from './reporters/ConsoleReporter.js';
import JsonReporter from './reporters/JsonReporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('hytopia-bench')
  .description('Performance benchmarking tools for HYTOPIA games')
  .version('0.1.0');

program
  .command('run')
  .description('Run a benchmark scenario')
  .argument('[scenario]', 'Path to scenario YAML/JSON file')
  .option('--preset <name>', 'Use a built-in preset (idle, stress, large-world, many-players, combined, join-storm, block-churn, entity-density, multi-world, blocks-10k-dense, blocks-500k-dense, blocks-1m-dense, blocks-10m-dense, blocks-1m-multi-world, hyfire2-bots, zoo-game-bots, zoo-game-full, zoo-game-observe)')
  .option('--output <path>', 'Write results to JSON file')
  .option('--full-data', 'Include raw metric data in output')
  .option('--baseline <path>', 'Compare results against a baseline JSON')
  .option('--server-cmd <cmd>', 'Command to start the game server')
  .option('--server-cwd <path>', 'Working directory for server')
  .option('--client-url <url>', 'Server base URL (used for health + perf endpoints)', 'https://local.hytopiahosting.com:8080')
  .option('--no-headless', 'Run browser in visible mode')
  .option('--no-perf-api', 'Skip PerfHarness API, use only OS-level monitoring')
  .option('--log-file <path>', 'Capture server stdout/stderr to file')
  .option('--with-client', 'Launch headless browser client and collect client-side metrics')
  .option('--client-dev-url <url>', 'URL for the Vite client dev server', 'http://localhost:4173')
  .option('--cpu-throttle <rate>', 'Apply browser CPU throttle rate (1=no throttle, 4=mid mobile, 16=low-end)', parseFloat)
  .option('--external-server <url>', 'Use an already-running external server (skip server startup)')
  .option('--verbose', 'Enable verbose logging')
  .action(async (scenarioPath, options) => {
    let scenario;

    if (options.preset) {
      const presetPath = path.join(__dirname, 'presets', `${options.preset}.yaml`);

      if (!fs.existsSync(presetPath)) {
        console.error('Unknown preset: %s. Available: idle, stress, large-world, many-players, combined, join-storm, block-churn, entity-density, multi-world, blocks-10k-dense, blocks-500k-dense, blocks-1m-dense, blocks-10m-dense, blocks-1m-multi-world, hyfire2-bots, zoo-game-bots, zoo-game-full, zoo-game-observe', options.preset);
        process.exit(1);
      }

      scenario = loadScenario(presetPath);
    } else if (scenarioPath) {
      scenario = loadScenario(scenarioPath);
    } else {
      console.error('Provide a scenario file or --preset name');
      process.exit(1);
    }

    const runner = new BenchmarkRunner({
      serverCommand: options.serverCmd,
      serverCwd: options.serverCwd,
      clientUrl: options.clientUrl,
      clientDevUrl: options.clientDevUrl,
      cpuThrottle: options.cpuThrottle,
      withClient: options.withClient ?? false,
      headless: options.headless !== false,
      verbose: options.verbose,
      noPerfApi: options.perfApi === false,
      logFile: options.logFile,
      externalServerUrl: options.externalServer,
    });

    console.log(`Running benchmark: ${scenario.name}`);

    const result = await runner.run(scenario);

    const consoleReporter = new ConsoleReporter();

    consoleReporter.reportBenchmark(result);

    if (!result.validation.valid) {
      process.exitCode = 1;
    }

    if (options.baseline && result.validation.valid) {
      const baseline = BaselineComparer.loadBaseline(options.baseline);
      const comparer = new BaselineComparer();
      const comparison = comparer.compare(baseline, result.baseline, scenario.name);

      consoleReporter.reportComparison(comparison);

      if (comparison.overallStatus === 'fail') {
        process.exitCode = 1;
      }
    } else if (options.baseline && !result.validation.valid) {
      console.error('Skipping baseline comparison because the new run is invalid.');
    }

    if (options.output) {
      const jsonReporter = new JsonReporter();

      if (options.fullData) {
        jsonReporter.writeFullData(result, options.output);
      } else {
        const report = jsonReporter.generateReport(result);

        jsonReporter.writeReport(report, options.output);
      }

      console.log(`Results written to: ${options.output}`);
    }
  });

program
  .command('compare')
  .description('Compare two baseline files')
  .argument('<before>', 'Path to baseline (before) JSON')
  .argument('<after>', 'Path to baseline (after) JSON')
  .option('--warn <pct>', 'Warning threshold percentage', '5')
  .option('--fail <pct>', 'Failure threshold percentage', '15')
  .option('--fail-on-regression', 'Exit with code 1 if any metric regresses beyond fail threshold')
  .action((beforePath, afterPath, options) => {
    const beforeInput = BaselineComparer.loadInput(beforePath);
    const afterInput = BaselineComparer.loadInput(afterPath);
    const before = beforeInput.baseline;
    const after = afterInput.baseline;

    const comparer = new BaselineComparer({
      warningThresholdPct: parseFloat(options.warn),
      failThresholdPct: parseFloat(options.fail),
    });

    if (beforeInput.validation?.valid === false || afterInput.validation?.valid === false) {
      console.error('Cannot compare invalid benchmark reports.');

      if (beforeInput.validation?.valid === false) {
        console.error(`  ${beforePath}`);
        for (const issue of beforeInput.validation.issues ?? []) {
          console.error(`    - ${issue}`);
        }
      }

      if (afterInput.validation?.valid === false) {
        console.error(`  ${afterPath}`);
        for (const issue of afterInput.validation.issues ?? []) {
          console.error(`    - ${issue}`);
        }
      }

      process.exit(1);
    }

    const includeServerMetrics = hasServerMetrics(beforeInput) && hasServerMetrics(afterInput);
    const includeClientMetrics = hasClientMetrics(beforeInput) && hasClientMetrics(afterInput);
    const includeClientRenderMetrics = includeClientMetrics && hasClientRenderMetrics(beforeInput) && hasClientRenderMetrics(afterInput);

    if (!includeServerMetrics && !includeClientMetrics) {
      console.error('Cannot compare these reports because they do not share any comparable metric categories.');
      process.exit(1);
    }

    if (!includeServerMetrics) {
      console.log('Skipping server metrics: one or both reports lack server snapshots.');
    }

    if (!includeClientMetrics) {
      console.log('Skipping client metrics: one or both reports lack client snapshots.');
    } else if (!includeClientRenderMetrics) {
      console.log('Skipping client draw-call and triangle metrics: one or both reports lack usable render counters.');
    }

    const comparison = comparer.compare(
      before,
      after,
      `${path.basename(beforePath)} vs ${path.basename(afterPath)}`,
      {
        includeServerMetrics,
        includeClientMetrics,
        includeClientRenderMetrics,
      },
    );

    const reporter = new ConsoleReporter();

    reporter.reportComparison(comparison);

    if (options.failOnRegression && comparison.overallStatus === 'fail') {
      process.exitCode = 1;
    }
  });

program
  .command('presets')
  .description('List available built-in presets')
  .action(() => {
    const presetsDir = path.join(__dirname, 'presets');

    if (!fs.existsSync(presetsDir)) {
      console.log('No presets directory found');
      return;
    }

    const files = fs.readdirSync(presetsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    console.log('Available presets:');

    for (const file of files) {
      const scenario = loadScenario(path.join(presetsDir, file));

      console.log(`  ${path.basename(file, path.extname(file))}: ${scenario.description ?? scenario.name}`);
    }
  });

program.parse();

function hasServerMetrics(input: ReturnType<typeof BaselineComparer.loadInput>): boolean {
  if ((input.metrics?.serverSnapshotCount ?? 0) > 0) {
    return true;
  }

  return input.baseline.avgTickMs > 0 || Object.keys(input.baseline.operations ?? {}).length > 0 || input.baseline.network !== undefined;
}

function hasClientMetrics(input: ReturnType<typeof BaselineComparer.loadInput>): boolean {
  if ((input.metrics?.clientSnapshotCount ?? 0) > 0) {
    return true;
  }

  return input.baseline.client !== undefined || input.baseline.avgFps !== undefined;
}

function hasClientRenderMetrics(input: ReturnType<typeof BaselineComparer.loadInput>): boolean {
  const client = input.baseline.client;

  if (!client) {
    return false;
  }

  return client.avgDrawCalls > 0 || client.maxDrawCalls > 0 || client.avgTriangles > 0 || client.maxTriangles > 0;
}
