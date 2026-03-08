import EntityStats from '../entities/EntityStats';
import ChunkStats from '../chunks/ChunkStats';
import GLTFStats from '../gltf/GLTFStats';
import type Game from '../Game';

export default class PerfBridge {
  private _game: Game;

  constructor(game: Game) {
    this._game = game;

    const self = this;
    const perf: any = {
      snapshot: () => self._snapshot(),
      get fps() { return game.performanceMetricsManager.fps; },
      get frameTimeMs() { return game.performanceMetricsManager.deltaTime * 1000; },
      get drawCalls() { return game.renderer.webGLRenderer.info.render.calls; },
      get triangles() { return game.renderer.webGLRenderer.info.render.triangles; },
      get textureMemoryMb() { return 0; },
    };

    (window as any).__HYTOPIA_PERF__ = perf;

    // Expose game instance for headless client control (camera, input)
    (window as any).__HYTOPIA_GAME__ = game;
  }

  private _snapshot() {
    const perf = this._game.performanceMetricsManager;
    const info = this._game.renderer.webGLRenderer.info;

    return {
      fps: perf.fps,
      frameTimeMs: perf.deltaTime * 1000,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: (info as any).programs?.length ?? 0,
      textureMemoryMb: 0,
      usedMemoryMb: perf.usedMemory / (1024 * 1024),
      totalMemoryMb: perf.totalMemory / (1024 * 1024),
      entities: {
        count: EntityStats.count,
        inViewDistance: EntityStats.inViewDistanceCount,
        frustumCulled: EntityStats.frustumCulledCount,
        staticEnvironment: EntityStats.staticEnvironmentCount,
      },
      chunks: {
        count: ChunkStats.count,
        visible: ChunkStats.visibleCount,
        blocks: ChunkStats.blockCount,
        opaqueFaces: ChunkStats.opaqueFaceCount,
        transparentFaces: ChunkStats.transparentFaceCount,
        liquidFaces: ChunkStats.liquidFaceCount,
      },
      gltf: {
        files: GLTFStats.fileCount,
        sourceMeshes: GLTFStats.sourceMeshCount,
        clonedMeshes: GLTFStats.clonedMeshCount,
        instancedMeshes: GLTFStats.instancedMeshCount,
        drawCallsSaved: GLTFStats.drawCallsSaved,
      },
    };
  }
}
