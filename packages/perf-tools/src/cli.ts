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
  .option('--preset <name>', 'Use a built-in preset (idle, stress, large-world, many-players, combined, join-storm, block-churn, entity-density, multi-world, blocks-10k-dense, blocks-500k-dense, blocks-1m-dense, blocks-10m-dense, blocks-1m-multi-world, hyfire2-bots, zoo-game-bots)')
  .option('--output <path>', 'Write results to JSON file')
  .option('--full-data', 'Include raw metric data in output')
  .option('--baseline <path>', 'Compare results against a baseline JSON')
  .option('--server-cmd <cmd>', 'Command to start the game server')
  .option('--server-cwd <path>', 'Working directory for server')
  .option('--client-url <url>', 'Server base URL (used for health + perf endpoints)', 'https://local.hytopiahosting.com:8080')
  .option('--no-headless', 'Run browser in visible mode')
  .option('--no-perf-api', 'Skip PerfHarness API, use only OS-level monitoring')
  .option('--log-file <path>', 'Capture server stdout/stderr to file')
  .option('--verbose', 'Enable verbose logging')
  .action(async (scenarioPath, options) => {
    let scenario;

    if (options.preset) {
      const presetPath = path.join(__dirname, 'presets', `${options.preset}.yaml`);

      if (!fs.existsSync(presetPath)) {
        console.error('Unknown preset: %s. Available: idle, stress, large-world, many-players, combined, join-storm, block-churn, entity-density, multi-world, blocks-10k-dense, blocks-500k-dense, blocks-1m-dense, blocks-10m-dense, blocks-1m-multi-world, hyfire2-bots, zoo-game-bots', options.preset);
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
      headless: options.headless !== false,
      verbose: options.verbose,
      noPerfApi: options.perfApi === false,
      logFile: options.logFile,
    });

    console.log(`Running benchmark: ${scenario.name}`);

    const result = await runner.run(scenario);

    const consoleReporter = new ConsoleReporter();

    consoleReporter.reportBenchmark(result);

    if (options.baseline) {
      const baseline = BaselineComparer.loadBaseline(options.baseline);
      const comparer = new BaselineComparer();
      const comparison = comparer.compare(baseline, result.baseline, scenario.name);

      consoleReporter.reportComparison(comparison);

      if (comparison.overallStatus === 'fail') {
        process.exitCode = 1;
      }
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
    const before = BaselineComparer.loadBaseline(beforePath);
    const after = BaselineComparer.loadBaseline(afterPath);

    const comparer = new BaselineComparer({
      warningThresholdPct: parseFloat(options.warn),
      failThresholdPct: parseFloat(options.fail),
    });

    const comparison = comparer.compare(before, after, `${path.basename(beforePath)} vs ${path.basename(afterPath)}`);

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
