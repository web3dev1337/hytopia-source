import { CHUNK_SIZE, CHUNK_SIZE_BITS, CHUNK_VOLUME } from '@/worlds/blocks/Chunk';
import WorldManager from '@/worlds/WorldManager';
import type Vector3Like from '@/shared/types/math/Vector3Like';
import type World from '@/worlds/World';

export type PerfWorldLayout = 'dense' | 'slab';

export interface PerfGenerateBlocksOptions {
  worldId?: number;
  blockCount: number;
  blockTypeId: number;
  layout?: PerfWorldLayout;
  slabHeight?: number;
  origin?: Vector3Like;
  clear?: boolean;
}

export interface PerfGenerateBlocksResult {
  worldId: number;
  layout: PerfWorldLayout;
  blockTypeId: number;
  requestedBlocks: number;
  placedBlocks: number;
  chunkCount: number;
  blocksPerChunk: number;
  durationMs: number;
  origin: Vector3Like;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function ensureBlockTypeRegistered(world: World, blockTypeId: number): void {
  const existing = world.blockTypeRegistry.getAllBlockTypes().some(bt => bt.id === blockTypeId);
  if (existing) return;

  world.blockTypeRegistry.registerGenericBlockType({
    id: blockTypeId,
    name: `perf-block-${blockTypeId}`,
    textureUri: 'blocks/stone.png',
  });
}

function getWorld(worldId?: number): World {
  if (typeof worldId === 'number') {
    const world = WorldManager.instance.getWorld(Math.floor(worldId));
    if (world) return world;
  }

  return WorldManager.instance.getDefaultWorld();
}

function computeGridSize(chunkCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(chunkCount)));
}

function fillDenseChunk(
  blocks: Uint8Array,
  blockTypeId: number,
  fillCount: number,
): void {
  if (fillCount <= 0) return;

  if (fillCount >= CHUNK_VOLUME) {
    blocks.fill(blockTypeId);

    return;
  }

  blocks.fill(0);
  blocks.fill(blockTypeId, 0, fillCount);
}

function fillSlabChunk(
  blocks: Uint8Array,
  blockTypeId: number,
  slabHeight: number,
  fillCount: number,
): void {
  blocks.fill(0);

  const perChunk = CHUNK_SIZE * slabHeight * CHUNK_SIZE;
  const target = Math.max(0, Math.min(perChunk, fillCount));
  if (target === 0) return;

  let remaining = target;

  for (let y = 0; y < slabHeight && remaining > 0; y++) {
    const yOffset = y << CHUNK_SIZE_BITS;

    for (let z = 0; z < CHUNK_SIZE && remaining > 0; z++) {
      const start = yOffset + (z << (CHUNK_SIZE_BITS * 2));
      const run = Math.min(CHUNK_SIZE, remaining);

      blocks.fill(blockTypeId, start, start + run);
      remaining -= run;
    }
  }
}

export default class PerfWorldGenerator {
  public static generateBlocks(options: PerfGenerateBlocksOptions): PerfGenerateBlocksResult {
    const start = performance.now();

    const requestedBlocks = clampInt(options.blockCount, 0, Number.MAX_SAFE_INTEGER);
    const blockTypeId = clampInt(options.blockTypeId, 1, 255);
    const layout: PerfWorldLayout = options.layout === 'slab' ? 'slab' : 'dense';
    const origin: Vector3Like = options.origin ?? { x: 0, y: 0, z: 0 };
    const clear = options.clear !== false;

    const world = getWorld(options.worldId);

    ensureBlockTypeRegistered(world, blockTypeId);

    if (clear) {
      world.chunkLattice.clear();
    }

    const slabHeight = layout === 'slab' ? clampInt(options.slabHeight ?? 1, 1, CHUNK_SIZE) : CHUNK_SIZE;
    const blocksPerChunk = layout === 'slab' ? CHUNK_SIZE * slabHeight * CHUNK_SIZE : CHUNK_VOLUME;
    const chunkCount = requestedBlocks === 0 ? 0 : Math.ceil(requestedBlocks / blocksPerChunk);
    const grid = computeGridSize(chunkCount);

    let placedBlocks = 0;

    for (let i = 0; i < chunkCount; i++) {
      const remaining = requestedBlocks - placedBlocks;
      const fillCount = Math.min(blocksPerChunk, remaining);

      const gx = i % grid;
      const gz = Math.floor(i / grid);

      const chunk = world.chunkLattice.getOrCreateChunk({
        x: origin.x + gx * CHUNK_SIZE,
        y: origin.y,
        z: origin.z + gz * CHUNK_SIZE,
      });

      const blocks = chunk.blocks as Uint8Array;

      if (layout === 'slab') {
        fillSlabChunk(blocks, blockTypeId, slabHeight, fillCount);
      } else {
        fillDenseChunk(blocks, blockTypeId, fillCount);
      }

      placedBlocks += fillCount;
    }

    return {
      worldId: world.id,
      layout,
      blockTypeId,
      requestedBlocks,
      placedBlocks,
      chunkCount,
      blocksPerChunk,
      durationMs: performance.now() - start,
      origin,
    };
  }
}
