import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'zlib';
import ErrorHandler from '@/errors/ErrorHandler';
import { BLOCK_ROTATIONS } from '@/worlds/blocks/Block';
import Chunk, { CHUNK_VOLUME } from '@/worlds/blocks/Chunk';
import type { BlockRotation } from '@/worlds/blocks/Block';
import type { BlockTypeOptions } from '@/worlds/blocks/BlockType';
import type Vector3Like from '@/shared/types/math/Vector3Like';
import type { WorldMap } from '@/worlds/World';
import WorldMapCodec from '@/worlds/maps/WorldMapCodec';
import type { CompressedWorldMap } from '@/worlds/maps/WorldMapCodec';
import {
  WORLD_MAP_CHUNK_CACHE_HEADER_SIZE,
  WORLD_MAP_CHUNK_CACHE_MAGIC,
  WORLD_MAP_CHUNK_CACHE_VERSION,
  chunkCacheAlgorithmToByte,
  chunkCacheByteToAlgorithm,
} from '@/worlds/maps/WorldMapChunkCacheFormat';

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

  // Optional overlays. These are not part of the binary codec, but allow
  // loaders to provide entities/blockTypes from a sibling JSON map when the
  // cache was generated without them (or to override stale metadata).
  blockTypes?: BlockTypeOptions[] | Record<string, BlockTypeOptions>;
  entities?: WorldMap['entities'];
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

const BLOCK_ROTATIONS_BY_ENUM_INDEX: BlockRotation[] = Object
  .values(BLOCK_ROTATIONS)
  .sort((a, b) => a.enumIndex - b.enumIndex);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function zigzagEncode32(value: number): number {
  return (value << 1) ^ (value >> 31);
}

function zigzagDecode32(value: number): number {
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
  return varintSize(zigzagEncode32(signedValue));
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
  return writeVarint(buffer, offset, zigzagEncode32(signedValue));
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

  return { value: zigzagDecode32(r.value), offset: r.offset };
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

function normalizeBlockTypes(value: unknown): BlockTypeOptions[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as BlockTypeOptions[];
  if (isRecord(value)) return Object.values(value) as BlockTypeOptions[];

  return undefined;
}

export default class WorldMapChunkCacheCodec {
  private static _writeHeader(algorithm: WorldMapChunkCacheAlgorithm): Buffer {
    const header = Buffer.allocUnsafe(WORLD_MAP_CHUNK_CACHE_HEADER_SIZE);
    WORLD_MAP_CHUNK_CACHE_MAGIC.copy(header, 0);
    header.writeUInt8(WORLD_MAP_CHUNK_CACHE_VERSION, 8);
    header.writeUInt8(chunkCacheAlgorithmToByte(algorithm), 9);
    header.writeUInt16LE(0, 10); // reserved

    return header;
  }

  public static isWorldMapChunkCache(value: unknown): value is WorldMapChunkCache {
    if (!isRecord(value)) return false;
    if (typeof value.data !== 'string') return false;
    if (value.format === 'hytopia.worldmap.chunk-cache') return true;

    try {
      const prefix = Buffer.from(value.data.slice(0, 24), 'base64');
      if (prefix.byteLength < 8) return false;

      return prefix.subarray(0, 8).equals(WORLD_MAP_CHUNK_CACHE_MAGIC);
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

    const header = this._writeHeader(algorithm);

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
    const decodedMetadata = this._decodeMetadata(decoded.body);
    const includeRotations = decodedMetadata.metadata.options?.rotations === true;
    const chunkCount = decodedMetadata.chunkCount;
    const startOffset = decodedMetadata.offset;

    const chunks = this._decodeChunks(decoded.body, startOffset, chunkCount, includeRotations);

    return { metadata: decodedMetadata.metadata, chunks };
  }

  public static decodeMetadata(cache: WorldMapChunkCache): WorldMapChunkCacheMetadata {
    const decoded = this._decodeFile(cache);

    return this._decodeMetadata(decoded.body).metadata;
  }

  public static decodeChunks(cache: WorldMapChunkCache): Iterable<ChunkCacheChunk> {
    const decoded = this._decodeFile(cache);
    const metadataResult = this._decodeMetadata(decoded.body);
    const includeRotations = metadataResult.metadata.options?.rotations === true;

    return this._decodeChunks(decoded.body, metadataResult.offset, metadataResult.chunkCount, includeRotations);
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

        const localCoordinate = Chunk.blockIndexToLocalCoordinate(blockIndex);

        const key = `${origin.x + localCoordinate.x},${origin.y + localCoordinate.y},${origin.z + localCoordinate.z}`;
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
    if (raw.byteLength < WORLD_MAP_CHUNK_CACHE_HEADER_SIZE) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Cache data too small.');
    }

    const magic = raw.subarray(0, 8);
    if (!magic.equals(WORLD_MAP_CHUNK_CACHE_MAGIC)) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Invalid cache magic header.');
    }

    const version = raw.readUInt8(8);
    if (version !== WORLD_MAP_CHUNK_CACHE_VERSION) {
      ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Unsupported cache version ${version}.`);
    }

    const compressionByte = raw.readUInt8(9);
    const algorithm = chunkCacheByteToAlgorithm(compressionByte);

    const bodyCompressed = raw.subarray(WORLD_MAP_CHUNK_CACHE_HEADER_SIZE);
    const body = decompressData(algorithm, bodyCompressed);

    return { body, algorithm };
  }

  private static _decodeMetadata(body: Buffer): { metadata: WorldMapChunkCacheMetadata, chunkCount: number, offset: number } {
    let offset = 0;
    const metaLenVarint = readVarint(body, offset);
    offset = metaLenVarint.offset;
    const metaLen = metaLenVarint.value;

    if (body.byteLength < offset + metaLen) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec.decode(): Body too small for metadata.');
    }

    const metadataText = body.subarray(offset, offset + metaLen).toString('utf8');
    const metadata = JSON.parse(metadataText) as WorldMapChunkCacheMetadata;
    metadata.blockTypes = normalizeBlockTypes(metadata.blockTypes);
    offset += metaLen;

    const chunkCountVarint = readVarint(body, offset);
    offset = chunkCountVarint.offset;

    return { metadata, chunkCount: chunkCountVarint.value, offset };
  }

  private static _decodeChunks(
    body: Buffer,
    startOffset: number,
    chunkCount: number,
    includeRotations: boolean,
  ): Iterable<ChunkCacheChunk> {
    let offset = startOffset;

    function* chunks(): Generator<ChunkCacheChunk> {
      for (let i = 0; i < chunkCount; i++) {
        let r = readSignedVarint(body, offset);
        const x = r.value;
        offset = r.offset;

        r = readSignedVarint(body, offset);
        const y = r.value;
        offset = r.offset;

        r = readSignedVarint(body, offset);
        const z = r.value;
        offset = r.offset;

        const blocksStart = offset;
        const blocksEnd = blocksStart + CHUNK_VOLUME;
        if (body.byteLength < blocksEnd) {
          ErrorHandler.fatalError('WorldMapChunkCacheCodec.decode(): Body too small for chunk blocks.');
        }

        const blocks = body.subarray(blocksStart, blocksEnd);
        offset = blocksEnd;

        const blockRotations: Map<number, BlockRotation> = new Map();
        if (includeRotations) {
          const rotCountVarint = readVarint(body, offset);
          const rotCount = rotCountVarint.value;
          offset = rotCountVarint.offset;

          for (let j = 0; j < rotCount; j++) {
            const blockIndexVarint = readVarint(body, offset);
            const blockIndex = blockIndexVarint.value;
            offset = blockIndexVarint.offset;

            if (blockIndex >= CHUNK_VOLUME) {
              ErrorHandler.fatalError(`WorldMapChunkCacheCodec.decode(): Invalid block index ${blockIndex} (expected 0-${CHUNK_VOLUME - 1}).`);
            }

            const rotationEnumIndex = body.readUInt8(offset++);
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

    return chunks();
  }

  private static _encodeBody(
    map: WorldMap | CompressedWorldMap,
    options: { includeRotations?: boolean, sourceSha256?: string },
  ): { encoded: Buffer, hasRotations: boolean } {
    type ChunkAccumulator = {
      originCoordinate: Vector3Like;
      blocks: Uint8Array;
      rotationsByBlockIndex: Map<number, number>;
    };

    const chunksByKey = new Map<string, ChunkAccumulator>();
    let hasRotations = false;

    const addBlockToChunk = (globalCoordinate: Vector3Like, blockTypeId: number, rotationEnumIndex: number) => {
      validateSafeInt(globalCoordinate.x, 'block x');
      validateSafeInt(globalCoordinate.y, 'block y');
      validateSafeInt(globalCoordinate.z, 'block z');

      if (!Number.isInteger(blockTypeId) || blockTypeId < 0 || blockTypeId > 255) {
        ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Invalid block type id ${blockTypeId} (expected 0-255).`);
      }

      if (!Number.isInteger(rotationEnumIndex) || rotationEnumIndex < 0 || rotationEnumIndex > 255) {
        ErrorHandler.fatalError(`WorldMapChunkCacheCodec: Invalid rotation enumIndex ${rotationEnumIndex} (expected 0-255).`);
      }

      const originCoordinate = Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
      const chunkKey = `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
      let chunk = chunksByKey.get(chunkKey);
      if (!chunk) {
        chunk = {
          originCoordinate,
          blocks: new Uint8Array(CHUNK_VOLUME),
          rotationsByBlockIndex: new Map(),
        };
        chunksByKey.set(chunkKey, chunk);
      }

      const localCoordinate = Chunk.globalCoordinateToLocalCoordinate(globalCoordinate);
      const blockIndex = Chunk.localCoordinateToBlockIndex(localCoordinate);
      chunk.blocks[blockIndex] = blockTypeId;

      if (rotationEnumIndex !== 0) {
        chunk.rotationsByBlockIndex.set(blockIndex, rotationEnumIndex);
        hasRotations = true;
      }
    };

    if (WorldMapCodec.isCompressedWorldMap(map)) {
      for (const entry of WorldMapCodec.decodeBlockEntries(map)) {
        addBlockToChunk(entry.globalCoordinate, entry.blockTypeId, entry.blockRotation?.enumIndex ?? 0);
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
        addBlockToChunk({ x, y, z }, blockTypeId, rotationEnumIndex);
      }
    }

    const includeRotations = options.includeRotations ?? hasRotations;
    if (!includeRotations && hasRotations) {
      ErrorHandler.fatalError('WorldMapChunkCacheCodec: Map contains rotated blocks but includeRotations is false.');
    }

    const rotationsEnabled = includeRotations && hasRotations;

    const metadata: WorldMapChunkCacheMetadata = {
      blockTypes: normalizeBlockTypes(map.blockTypes),
      entities: map.entities,
      options: { rotations: rotationsEnabled },
      source: options.sourceSha256 ? { sha256: options.sourceSha256 } : undefined,
      metadata: WorldMapCodec.isCompressedWorldMap(map) ? map.metadata : undefined,
      mapVersion: WorldMapCodec.isCompressedWorldMap(map) ? map.mapVersion : undefined,
    };

    const metadataJson = Buffer.from(JSON.stringify(metadata), 'utf8');

    const chunkCount = chunksByKey.size;
    const chunks = Array.from(chunksByKey.values());
    chunks.sort((a, b) => (
      a.originCoordinate.y - b.originCoordinate.y ||
      a.originCoordinate.x - b.originCoordinate.x ||
      a.originCoordinate.z - b.originCoordinate.z
    ));

    let chunksSectionSize = 0;
    for (const chunk of chunks) {
      chunksSectionSize += signedVarintSize(chunk.originCoordinate.x);
      chunksSectionSize += signedVarintSize(chunk.originCoordinate.y);
      chunksSectionSize += signedVarintSize(chunk.originCoordinate.z);
      chunksSectionSize += CHUNK_VOLUME;

      if (rotationsEnabled) {
        const rotEntries = Array.from(chunk.rotationsByBlockIndex.entries());
        chunksSectionSize += varintSize(rotEntries.length);
        for (const [ blockIndex ] of rotEntries) {
          chunksSectionSize += varintSize(blockIndex);
          chunksSectionSize += 1;
        }
      }
    }

    const bodySize =
      varintSize(metadataJson.byteLength) +
      metadataJson.byteLength +
      varintSize(chunkCount) +
      chunksSectionSize;

    const body = Buffer.allocUnsafe(bodySize);
    let offset = 0;

    offset = writeVarint(body, offset, metadataJson.byteLength);
    metadataJson.copy(body, offset);
    offset += metadataJson.byteLength;

    offset = writeVarint(body, offset, chunkCount);

    for (const chunk of chunks) {
      offset = writeSignedVarint(body, offset, chunk.originCoordinate.x);
      offset = writeSignedVarint(body, offset, chunk.originCoordinate.y);
      offset = writeSignedVarint(body, offset, chunk.originCoordinate.z);

      body.set(chunk.blocks, offset);
      offset += CHUNK_VOLUME;

      if (rotationsEnabled) {
        const rotEntries = Array.from(chunk.rotationsByBlockIndex.entries());
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
