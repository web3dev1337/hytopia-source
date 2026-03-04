import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'zlib';
import ErrorHandler from '@/errors/ErrorHandler';
import { BLOCK_ROTATIONS } from '@/worlds/blocks/Block';
import type { BlockRotation } from '@/worlds/blocks/Block';
import type { BlockTypeOptions } from '@/worlds/blocks/BlockType';
import type Vector3Like from '@/shared/types/math/Vector3Like';
import type { WorldMap } from '@/worlds/World';
import WorldMapCodec from '@/worlds/maps/WorldMapCodec';
import type { CompressedWorldMap } from '@/worlds/maps/WorldMapCodec';

export type WorldMapChunkCacheAlgorithm = 'brotli' | 'gzip' | 'none';

export interface WorldMapChunkCacheOptions {
  rotations?: boolean;
}

export interface WorldMapChunkCacheMetadata {
  blockTypes?: BlockTypeOptions[];
  entities?: WorldMap['entities'];
  options?: WorldMapChunkCacheOptions;
  source?: { sha256?: string };
  metadata?: unknown;
  mapVersion?: unknown;
}

export interface WorldMapChunkCache {
  format?: 'hytopia.worldmap.chunk-cache';
  codecVersion?: number;
  version?: string;

  algorithm?: WorldMapChunkCacheAlgorithm;
  data: string;
}

export interface CreateWorldMapChunkCacheOptions {
  algorithm?: WorldMapChunkCacheAlgorithm;
  level?: number;
  includeRotations?: boolean;
  sourceSha256?: string;
}

export interface ChunkCacheChunk {
  originCoordinate: Vector3Like;
  blocks: Uint8Array; // length 4096
  blockRotations: Map<number, BlockRotation>; // blockIndex -> rotation
}

const FILE_MAGIC = Buffer.from('HYTCHUNK'); // 8 bytes
const FILE_VERSION = 1;

const CHUNK_SIZE_BITS = 4;
const CHUNK_AXES_RANGE = 15;
const CHUNK_VOLUME = 16 ** 3;

const BLOCK_ROTATIONS_BY_ENUM_INDEX: BlockRotation[] = Object
  .values(BLOCK_ROTATIONS)
  .sort((a, b) => a.enumIndex - b.enumIndex);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function encodeZigzag32(value: number): number {
  return (value << 1) ^ (value >> 31);
}

function decodeZigzag32(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

function varintSize(value: number): number {
  let current = value >>> 0;
  let size = 1;
  while (current > 0x7f) {
    size++;
    current >>>= 7;
  }

  return size;
}

function signedVarintSize(signedValue: number): number {
  return varintSize(encodeZigzag32(signedValue));
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

function readSignedVarint(buffer: Buffer, offset: number): { value: number, offset: number } {
  const r = readVarint(buffer, offset);

  return { value: decodeZigzag32(r.value), offset: r.offset };
}

function compressData(algorithm: WorldMapChunkCacheAlgorithm, input: Buffer, level: number): Buffer {
  if (algorithm === 'none') return input;
  if (algorithm === 'gzip') return gzipSync(input, { level: Math.min(9, Math.max(0, level)) });

  return brotliCompressSync(input, {
    params: {
      [ constants.BROTLI_PARAM_MODE ]: constants.BROTLI_MODE_GENERIC,
      [ constants.BROTLI_PARAM_QUALITY ]: Math.min(11, Math.max(0, level)),
      [ constants.BROTLI_PARAM_SIZE_HINT ]: input.byteLength,
    },
  });
}

function decompressData(algorithm: WorldMapChunkCacheAlgorithm, input: Buffer): Buffer {
  if (algorithm === 'none') return input;
  if (algorithm === 'gzip') return gunzipSync(input);

  return brotliDecompressSync(input);
}

function validateSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    ErrorHandler.fatalError(`WorldMapChunkCacheCodec: ${label} must be a safe integer.`);
  }
}

function originFromGlobalCoordinate(global: Vector3Like): Vector3Like {
  return {
    x: (global.x | 0) - (global.x & CHUNK_AXES_RANGE),
    y: (global.y | 0) - (global.y & CHUNK_AXES_RANGE),
    z: (global.z | 0) - (global.z & CHUNK_AXES_RANGE),
  };
}

function blockIndexFromGlobalCoordinate(global: Vector3Like): number {
  const lx = global.x & CHUNK_AXES_RANGE;
  const ly = global.y & CHUNK_AXES_RANGE;
  const lz = global.z & CHUNK_AXES_RANGE;

  return lx + (ly << CHUNK_SIZE_BITS) + (lz << (CHUNK_SIZE_BITS * 2));
}

function normalizeBlockTypes(value: unknown): BlockTypeOptions[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as BlockTypeOptions[];
  if (isRecord(value)) return Object.values(value) as BlockTypeOptions[];

  return undefined;
}

export default class WorldMapChunkCacheCodec {
  public static isWorldMapChunkCache(value: unknown): value is WorldMapChunkCache {
    if (!isRecord(value)) return false;
    if (typeof value.data !== 'string') return false;
    if (value.format === 'hytopia.worldmap.chunk-cache') return true;

    try {
      const prefix = Buffer.from(value.data.slice(0, 24), 'base64');
      if (prefix.byteLength < 8) return false;

      return prefix.subarray(0, 8).equals(FILE_MAGIC);
    } catch {
      return false;
    }
  }

  public static create(map: WorldMap | CompressedWorldMap, options: CreateWorldMapChunkCacheOptions = {}): WorldMapChunkCache {
    const algorithm = options.algorithm ?? 'brotli';
    const level = options.level ?? 6;

    const { encoded } = this._encodeBody(map, {
      includeRotations: options.includeRotations,
      sourceSha256: options.sourceSha256,
    });

    const header = Buffer.allocUnsafe(12);
    FILE_MAGIC.copy(header, 0);
    header.writeUInt8(FILE_VERSION, 8);
    header.writeUInt8(algorithm === 'none' ? 0 : (algorithm === 'gzip' ? 2 : 1), 9);
    header.writeUInt16LE(0, 10);

    const bodyCompressed = compressData(algorithm, encoded, level);
    const file = Buffer.concat([ header, bodyCompressed ]);

    return {
      format: 'hytopia.worldmap.chunk-cache',
      codecVersion: 1,
      version: '1.0.0',
      algorithm,
      data: file.toString('base64'),
    };
  }

  public static decode(cache: WorldMapChunkCache): { metadata: WorldMapChunkCacheMetadata, chunks: Iterable<ChunkCacheChunk> } {
    const decoded = this._decodeFile(cache);
    let offset = 0;

    const rMetaLen = readVarint(decoded.body, offset);
    offset = rMetaLen.offset;
    const metaLen = rMetaLen.value;

    if (decoded.body.byteLength < offset + metaLen) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec.decode(): Body too small for metadata.');
    }

    const metadataText = decoded.body.subarray(offset, offset + metaLen).toString('utf8');
    const metadata = JSON.parse(metadataText) as WorldMapChunkCacheMetadata;
    metadata.blockTypes = normalizeBlockTypes(metadata.blockTypes);
    offset += metaLen;

    const rChunkCount = readVarint(decoded.body, offset);
    const chunkCount = rChunkCount.value;
    offset = rChunkCount.offset;

    const includeRotations = metadata.options?.rotations === true;

    function* chunks(): Generator<ChunkCacheChunk> {
      for (let i = 0; i < chunkCount; i++) {
        let r = readSignedVarint(decoded.body, offset);
        const x = r.value;
        offset = r.offset;

        r = readSignedVarint(decoded.body, offset);
        const y = r.value;
        offset = r.offset;

        r = readSignedVarint(decoded.body, offset);
        const z = r.value;
        offset = r.offset;

        const blocksStart = offset;
        const blocksEnd = blocksStart + CHUNK_VOLUME;
        if (decoded.body.byteLength < blocksEnd) {
          ErrorHandler.fatalError('WorldMapChunkCacheCodec.decode(): Body too small for chunk blocks.');
        }

        const blocks = decoded.body.subarray(blocksStart, blocksEnd);
        offset = blocksEnd;

        const blockRotations: Map<number, BlockRotation> = new Map();
        if (includeRotations) {
          const rRotCount = readVarint(decoded.body, offset);
          const rotCount = rRotCount.value;
          offset = rRotCount.offset;

          for (let j = 0; j < rotCount; j++) {
            const rIndex = readVarint(decoded.body, offset);
            const blockIndex = rIndex.value;
            offset = rIndex.offset;

            const rotationEnumIndex = decoded.body.readUInt8(offset++);
            const rot = BLOCK_ROTATIONS_BY_ENUM_INDEX[rotationEnumIndex];
            if (!rot) {
              ErrorHandler.fatalError(`WorldMapChunkCacheCodec.decode(): Invalid rotation enumIndex ${rotationEnumIndex}.`);
            }

            blockRotations.set(blockIndex, rot);
          }
        }

        yield {
          originCoordinate: { x, y, z },
          blocks,
          blockRotations,
        };
      }
    }

    return { metadata, chunks: chunks() };
  }

  public static decodeMetadata(cache: WorldMapChunkCache): WorldMapChunkCacheMetadata {
    return this.decode(cache).metadata;
  }

  public static decodeChunks(cache: WorldMapChunkCache): Iterable<ChunkCacheChunk> {
    return this.decode(cache).chunks;
  }

  public static decompressToWorldMap(cache: WorldMapChunkCache): WorldMap {
    const { metadata, chunks } = this.decode(cache);
    const blocks: NonNullable<WorldMap['blocks']> = {};
    const includeRotations = metadata.options?.rotations === true;

    for (const chunk of chunks) {
      const origin = chunk.originCoordinate;
      for (let blockIndex = 0; blockIndex < CHUNK_VOLUME; blockIndex++) {
        const id = chunk.blocks[blockIndex];
        if (id === 0) continue;

        const lx = blockIndex & CHUNK_AXES_RANGE;
        const ly = (blockIndex >> CHUNK_SIZE_BITS) & CHUNK_AXES_RANGE;
        const lz = (blockIndex >> (CHUNK_SIZE_BITS * 2)) & CHUNK_AXES_RANGE;

        const key = `${origin.x + lx},${origin.y + ly},${origin.z + lz}`;
        const rot = chunk.blockRotations.get(blockIndex);
        if (!includeRotations || !rot || rot.enumIndex === 0) {
          blocks[key] = id;
        } else {
          blocks[key] = { i: id, r: rot.enumIndex };
        }
      }
    }

    return {
      blockTypes: metadata.blockTypes,
      blocks,
      entities: metadata.entities,
    };
  }

  private static _decodeFile(cache: WorldMapChunkCache): { body: Buffer, algorithm: WorldMapChunkCacheAlgorithm } {
    const raw = Buffer.from(cache.data, 'base64');
    if (raw.byteLength < 12) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Cache data too small.');
    }

    const magic = raw.subarray(0, 8);
    if (!magic.equals(FILE_MAGIC)) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Invalid cache magic header.');
    }

    const version = raw.readUInt8(8);
    if (version !== FILE_VERSION) {
      ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Unsupported cache version ${version}.`);
    }

    const compressionByte = raw.readUInt8(9);
    const algorithm: WorldMapChunkCacheAlgorithm =
      compressionByte === 0 ? 'none' :
        compressionByte === 2 ? 'gzip' :
          'brotli';

    const bodyCompressed = raw.subarray(12);
    const body = decompressData(algorithm, bodyCompressed);

    return { body, algorithm };
  }

  private static _encodeBody(
    map: WorldMap | CompressedWorldMap,
    options: { includeRotations?: boolean, sourceSha256?: string },
  ): { encoded: Buffer, hasRotations: boolean } {
    const chunksByKey = new Map<string, { origin: Vector3Like, blocks: Uint8Array, rotations: Map<number, number> }>();
    let hasRotations = false;

    const addBlock = (globalCoordinate: Vector3Like, blockTypeId: number, rotationEnumIndex: number) => {
      validateSafeInt(globalCoordinate.x, 'block x');
      validateSafeInt(globalCoordinate.y, 'block y');
      validateSafeInt(globalCoordinate.z, 'block z');

      if (!Number.isInteger(blockTypeId) || blockTypeId < 0 || blockTypeId > 255) {
        ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Invalid block type id ${blockTypeId} (expected 0-255).`);
      }

      if (!Number.isInteger(rotationEnumIndex) || rotationEnumIndex < 0 || rotationEnumIndex > 255) {
        ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Invalid rotation enumIndex ${rotationEnumIndex} (expected 0-255).`);
      }

      const origin = originFromGlobalCoordinate(globalCoordinate);
      const key = `${origin.x},${origin.y},${origin.z}`;
      let chunk = chunksByKey.get(key);
      if (!chunk) {
        chunk = {
          origin,
          blocks: new Uint8Array(CHUNK_VOLUME),
          rotations: new Map(),
        };
        chunksByKey.set(key, chunk);
      }

      const blockIndex = blockIndexFromGlobalCoordinate(globalCoordinate);
      chunk.blocks[blockIndex] = blockTypeId;
      if (rotationEnumIndex !== 0) {
        chunk.rotations.set(blockIndex, rotationEnumIndex);
        hasRotations = true;
      }
    };

    if (WorldMapCodec.isCompressedWorldMap(map)) {
      for (const entry of WorldMapCodec.decodeBlockEntries(map)) {
        addBlock(entry.globalCoordinate, entry.blockTypeId, entry.blockRotation?.enumIndex ?? 0);
      }
    } else if (map.blocks) {
      for (const key in map.blocks) {
        const blockValue = map.blocks[key];
        const blockTypeId = typeof blockValue === 'number' ? blockValue : blockValue.i;
        const rotationEnumIndex = typeof blockValue === 'number' ? 0 : (blockValue.r ?? 0);
        const i1 = key.indexOf(',');
        const i2 = key.indexOf(',', i1 + 1);
        const x = Number(key.slice(0, i1));
        const y = Number(key.slice(i1 + 1, i2));
        const z = Number(key.slice(i2 + 1));
        addBlock({ x, y, z }, blockTypeId, rotationEnumIndex);
      }
    }

    const includeRotations = options.includeRotations ?? hasRotations;
    if (!includeRotations && hasRotations) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Map contains rotated blocks but includeRotations is false.');
    }

    const metadata: WorldMapChunkCacheMetadata = {
      blockTypes: WorldMapCodec.isCompressedWorldMap(map)
        ? (Array.isArray(map.blockTypes) ? map.blockTypes : (map.blockTypes ? Object.values(map.blockTypes) : undefined))
        : map.blockTypes,
      entities: WorldMapCodec.isCompressedWorldMap(map) ? map.entities : map.entities,
      options: { rotations: includeRotations && hasRotations },
      source: options.sourceSha256 ? { sha256: options.sourceSha256 } : undefined,
      metadata: (WorldMapCodec.isCompressedWorldMap(map) ? map.metadata : undefined),
      mapVersion: (WorldMapCodec.isCompressedWorldMap(map) ? map.mapVersion : undefined),
    };

    const metadataJson = Buffer.from(JSON.stringify(metadata), 'utf8');
    const metadataLenSize = varintSize(metadataJson.byteLength);

    const chunkCount = chunksByKey.size;
    const chunkCountSize = varintSize(chunkCount);

    const chunks = Array.from(chunksByKey.values());
    chunks.sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x || a.origin.z - b.origin.z);

    let chunksSize = 0;
    const rotationsEnabled = metadata.options?.rotations === true;
    for (const chunk of chunks) {
      chunksSize += signedVarintSize(chunk.origin.x);
      chunksSize += signedVarintSize(chunk.origin.y);
      chunksSize += signedVarintSize(chunk.origin.z);
      chunksSize += CHUNK_VOLUME;

      if (rotationsEnabled) {
        const rotEntries = Array.from(chunk.rotations.entries());
        chunksSize += varintSize(rotEntries.length);
        for (const [ blockIndex ] of rotEntries) {
          chunksSize += varintSize(blockIndex);
          chunksSize += 1;
        }
      }
    }

    const bodySize = metadataLenSize + metadataJson.byteLength + chunkCountSize + chunksSize;
    const body = Buffer.allocUnsafe(bodySize);
    let offset = 0;

    offset = writeVarint(body, offset, metadataJson.byteLength);
    metadataJson.copy(body, offset);
    offset += metadataJson.byteLength;

    offset = writeVarint(body, offset, chunkCount);

    for (const chunk of chunks) {
      offset = writeSignedVarint(body, offset, chunk.origin.x);
      offset = writeSignedVarint(body, offset, chunk.origin.y);
      offset = writeSignedVarint(body, offset, chunk.origin.z);

      body.set(chunk.blocks, offset);
      offset += CHUNK_VOLUME;

      if (rotationsEnabled) {
        const rotEntries = Array.from(chunk.rotations.entries());
        rotEntries.sort((a, b) => a[0] - b[0]);
        offset = writeVarint(body, offset, rotEntries.length);
        for (const [ blockIndex, rotEnumIndex ] of rotEntries) {
          offset = writeVarint(body, offset, blockIndex);
          body.writeUInt8(rotEnumIndex, offset++);
        }
      }
    }

    return { encoded: body, hasRotations: rotationsEnabled };
  }
}
