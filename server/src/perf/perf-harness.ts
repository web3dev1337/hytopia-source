import { startServer } from '@/GameServer';
import PerfHarness from '@/perf/PerfHarness';

startServer(world => {
  PerfHarness.enableIfConfigured();
  world.simulation.enableDebugRendering(false);
});

