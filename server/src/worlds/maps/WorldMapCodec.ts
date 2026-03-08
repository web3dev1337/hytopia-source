import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'zlib';
import ErrorHandler from '@/errors/ErrorHandler';
import { BLOCK_ROTATIONS } from '@/worlds/blocks/Block';
import type { BlockRotation } from '@/worlds/blocks/Block';
import type { BlockTypeOptions } from '@/worlds/blocks/BlockType';
import type Vector3Like from '@/shared/types/math/Vector3Like';
import type { WorldMap } from '@/worlds/World';

export type CompressedWorldMapAlgorithm = 'brotli' | 'gzip' | 'none';

export interface CompressedWorldMapBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CompressedWorldMapOptions {
  rotations?: boolean;
  useDelta?: boolean;
  useVarint?: boolean;
}

export interface CompressedWorldMap {
  format?: 'hytopia.worldmap.compressed';
  codecVersion?: number;
  version?: string;

  algorithm?: CompressedWorldMapAlgorithm;
  data: string;
  bounds: CompressedWorldMapBounds;

  blockTypes?: BlockTypeOptions[] | Record<string, BlockTypeOptions>;
  entities?: WorldMap['entities'];
  options?: CompressedWorldMapOptions;
  metadata?: unknown;
  mapVersion?: unknown;
}

export interface CompressWorldMapOptions {
  algorithm?: CompressedWorldMapAlgorithm;
  level?: number;
  includeRotations?: boolean;
}

const BLOCK_ROTATIONS_BY_INDEX: BlockRotation[] = Object.values(BLOCK_ROTATIONS).sort((a, b) => a.enumIndex - b.enumIndex);

function encodeZigzag32(value: number): number {
  return (value << 1) ^ (value >> 31);
}

function decodeZigzag32(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

function writeVarint(buffer: Buffer, offset: number, value: number): number {
  let current = value >>> 0;
  while (current > 0x7f) {
    buffer[offset++] = (current & 0x7f) | 0x80;
    current >>>= 7;
  }

  buffer[offset++] = current;
  
  return offset;
}

function writeSignedVarint(buffer: Buffer, offset: number, signedValue: number): number {
  return writeVarint(buffer, offset, encodeZigzag32(signedValue));
}

function readVarint(buffer: Buffer, offset: number): { value: number, offset: number } {
  let value = 0;
  let shift = 0;
  let byte = 0;

  do {
    byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);

  return { value: value >>> 0, offset };
}

function decompressData(algorithm: CompressedWorldMapAlgorithm, input: Buffer): Buffer {
  if (algorithm === 'none') {
    return input;
  }

  if (algorithm === 'gzip') {
    return gunzipSync(input);
  }

  return brotliDecompressSync(input);
}

function compressData(algorithm: CompressedWorldMapAlgorithm, input: Buffer, level: number): Buffer {
  if (algorithm === 'none') {
    return input;
  }

  if (algorithm === 'gzip') {
    return gzipSync(input, { level: Math.min(9, Math.max(0, level)) });
  }

  return brotliCompressSync(input, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
      [constants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(0, level)),
      [constants.BROTLI_PARAM_SIZE_HINT]: input.byteLength,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toBlockTypesArray(blockTypes: CompressedWorldMap['blockTypes']): BlockTypeOptions[] | undefined {
  if (!blockTypes) return undefined;
  if (Array.isArray(blockTypes)) return blockTypes;
  
  return Object.values(blockTypes);
}

export default class WorldMapCodec {
  public static isCompressedWorldMap(value: unknown): value is CompressedWorldMap {
    if (!isRecord(value)) return false;
    if (typeof value.data !== 'string') return false;
    if (!isRecord(value.bounds)) return false;

    const bounds = value.bounds;
    
    return typeof bounds.minX === 'number' &&
      typeof bounds.minY === 'number' &&
      typeof bounds.minZ === 'number' &&
      typeof bounds.maxX === 'number' &&
      typeof bounds.maxY === 'number' &&
      typeof bounds.maxZ === 'number';
  }

  public static compress(map: WorldMap, options: CompressWorldMapOptions = {}): CompressedWorldMap {
    const blocks = map.blocks ?? {};
    const blockEntries: Array<{ x: number, y: number, z: number, id: number, r: number }> = [];

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    let hasNonDefaultRotations = false;

    for (const key in blocks) {
      const blockValue = blocks[key];
      const blockTypeId = typeof blockValue === 'number' ? blockValue : blockValue.i;
      const rotationIndex = typeof blockValue === 'number' ? 0 : (blockValue.r ?? 0);

      if (!Number.isInteger(blockTypeId) || blockTypeId < 0 || blockTypeId > 255) {
        ErrorHandler.fatalError(`WorldMapCodec.compress(): Invalid block type id ${blockTypeId} at ${key} (expected 0-255).`);
      }

      if (!Number.isInteger(rotationIndex) || rotationIndex < 0 || rotationIndex >= BLOCK_ROTATIONS_BY_INDEX.length) {
        ErrorHandler.fatalError(`WorldMapCodec.compress(): Invalid block rotation index ${rotationIndex} at ${key}.`);
      }

      if (rotationIndex !== 0) {
        hasNonDefaultRotations = true;
      }

      const i1 = key.indexOf(',');
      const i2 = key.indexOf(',', i1 + 1);

      const x = Number(key.slice(0, i1));
      const y = Number(key.slice(i1 + 1, i2));
      const z = Number(key.slice(i2 + 1));

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);

      blockEntries.push({ x, y, z, id: blockTypeId, r: rotationIndex });
    }

    if (blockEntries.length === 0) {
      const empty: Buffer = Buffer.allocUnsafe(4);
      empty.writeUInt32LE(0, 0);

      const algorithm = options.algorithm ?? 'brotli';
      const level = options.level ?? 9;
      const compressed = compressData(algorithm, empty, level).toString('base64');

      return {
        format: 'hytopia.worldmap.compressed',
        codecVersion: 1,
        version: '1.0.0',
        algorithm,
        data: compressed,
        bounds: {
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: 0,
          maxY: 0,
          maxZ: 0,
        },
        blockTypes: map.blockTypes,
        entities: map.entities,
        options: {
          rotations: false,
          useDelta: true,
          useVarint: true,
        },
      };
    }

    const includeRotations = options.includeRotations ?? hasNonDefaultRotations;
    if (!includeRotations && hasNonDefaultRotations) {
      ErrorHandler.fatalError('WorldMapCodec.compress(): Map contains rotated blocks but includeRotations is false.');
    }

    for (let i = 0; i < blockEntries.length; i++) {
      const b = blockEntries[i];
      b.x -= minX;
      b.y -= minY;
      b.z -= minZ;
    }

    blockEntries.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);

    const perBlockBudget = includeRotations ? 25 : 20;
    const buffer = Buffer.allocUnsafe(4 + (blockEntries.length * perBlockBudget));
    let offset = 0;

    buffer.writeUInt32LE(blockEntries.length, offset);
    offset += 4;

    let lastX = 0;
    let lastY = 0;
    let lastZ = 0;

    for (let i = 0; i < blockEntries.length; i++) {
      const b = blockEntries[i];
      offset = writeSignedVarint(buffer, offset, b.x - lastX);
      offset = writeSignedVarint(buffer, offset, b.y - lastY);
      offset = writeSignedVarint(buffer, offset, b.z - lastZ);
      offset = writeSignedVarint(buffer, offset, b.id);
      if (includeRotations) {
        offset = writeSignedVarint(buffer, offset, b.r);
      }

      lastX = b.x;
      lastY = b.y;
      lastZ = b.z;
    }

    const encoded = buffer.slice(0, offset);
    const algorithm = options.algorithm ?? 'brotli';
    const level = options.level ?? 9;
    const compressed = compressData(algorithm, encoded, level).toString('base64');

    return {
      format: 'hytopia.worldmap.compressed',
      codecVersion: 1,
      version: '1.0.0',
      algorithm,
      data: compressed,
      bounds: { minX, minY, minZ, maxX, maxY, maxZ },
      blockTypes: map.blockTypes,
      entities: map.entities,
      options: {
        rotations: includeRotations,
        useDelta: true,
        useVarint: true,
      },
    };
  }

  public static decodeBlockEntries(map: CompressedWorldMap): Iterable<{
    globalCoordinate: Vector3Like;
    blockTypeId: number;
    blockRotation?: BlockRotation;
  }> {
    const algorithm = map.algorithm ?? 'brotli';
    const includeRotations = map.options?.rotations === true;

    const compressedBuffer = Buffer.from(map.data, 'base64');
    const decompressed = decompressData(algorithm, compressedBuffer);

    const bounds = map.bounds;
    let offset = 0;

    if (decompressed.byteLength < 4) {
      ErrorHandler.fatalError('WorldMapCodec.decodeBlockEntries(): Decompressed data is too small.');
    }

    const blockCount = decompressed.readUInt32LE(offset);
    offset += 4;

    function* entries(): Generator<{ globalCoordinate: Vector3Like, blockTypeId: number, blockRotation?: BlockRotation }> {
      let lastX = 0;
      let lastY = 0;
      let lastZ = 0;

      for (let i = 0; i < blockCount; i++) {
        let r = readVarint(decompressed, offset);
        lastX += decodeZigzag32(r.value);
        offset = r.offset;

        r = readVarint(decompressed, offset);
        lastY += decodeZigzag32(r.value);
        offset = r.offset;

        r = readVarint(decompressed, offset);
        lastZ += decodeZigzag32(r.value);
        offset = r.offset;

        r = readVarint(decompressed, offset);
        const blockTypeId = decodeZigzag32(r.value);
        offset = r.offset;

        let rotationIndex = 0;
        if (includeRotations) {
          r = readVarint(decompressed, offset);
          rotationIndex = decodeZigzag32(r.value);
          offset = r.offset;
        }

        if (rotationIndex < 0 || rotationIndex >= BLOCK_ROTATIONS_BY_INDEX.length) {
          ErrorHandler.fatalError(`WorldMapCodec.decodeBlockEntries(): Invalid rotation index ${rotationIndex} at block ${i}.`);
        }

        if (blockTypeId < 0 || blockTypeId > 255) {
          ErrorHandler.fatalError(`WorldMapCodec.decodeBlockEntries(): Invalid block type id ${blockTypeId} at block ${i} (expected 0-255).`);
        }

        const x = lastX + bounds.minX;
        const y = lastY + bounds.minY;
        const z = lastZ + bounds.minZ;

        yield {
          globalCoordinate: { x, y, z },
          blockTypeId,
          blockRotation: rotationIndex !== 0 ? BLOCK_ROTATIONS_BY_INDEX[rotationIndex] : undefined,
        };
      }
    }

    return entries();
  }

  public static decompressToWorldMap(map: CompressedWorldMap): WorldMap {
    const blockTypes = toBlockTypesArray(map.blockTypes);
    const entities = map.entities;
    const blocks: NonNullable<WorldMap['blocks']> = {};

    const includeRotations = map.options?.rotations === true;

    for (const entry of this.decodeBlockEntries(map)) {
      const key = `${entry.globalCoordinate.x},${entry.globalCoordinate.y},${entry.globalCoordinate.z}`;
      if (!includeRotations || !entry.blockRotation || entry.blockRotation.enumIndex === 0) {
        blocks[key] = entry.blockTypeId;
      } else {
        blocks[key] = { i: entry.blockTypeId, r: entry.blockRotation.enumIndex };
      }
    }

    return {
      blockTypes,
      blocks,
      entities,
    };
  }
}
