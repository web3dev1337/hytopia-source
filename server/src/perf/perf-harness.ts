import { startServer } from '@/GameServer';
import DefaultPlayerEntity from '@/worlds/entities/DefaultPlayerEntity';
import { PlayerEvent } from '@/players/Player';
import type Player from '@/players/Player';
import type World from '@/worlds/World';
import PerfHarness from '@/perf/PerfHarness';

startServer(world => {
  PerfHarness.enableIfConfigured();
  world.simulation.enableDebugRendering(false);

  // Spawn a player entity for real players so they can walk around (needed for headless client benchmarks)
  world.on(PlayerEvent.JOINED_WORLD, ({ player, world: w }: { player: Player; world: World }) => {
    const playerEntity = new DefaultPlayerEntity({
      player,
      name: 'PerfPlayer',
      modelUri: 'models/players/player.gltf',
    });

    playerEntity.spawn(w, { x: 0, y: 10, z: -20 });
  });

  world.on(PlayerEvent.LEFT_WORLD, ({ player, world: w }: { player: Player; world: World }) => {
    w.entityManager.getPlayerEntitiesByPlayer(player).forEach(e => e.despawn());
  });
});

