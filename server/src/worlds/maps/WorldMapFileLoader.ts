import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ErrorHandler from '@/errors/ErrorHandler';
import WorldMapCodec from '@/worlds/maps/WorldMapCodec';
import WorldMapChunkCacheCodec from '@/worlds/maps/WorldMapChunkCacheCodec';
import { WORLD_MAP_CHUNK_CACHE_MAGIC, WORLD_MAP_CHUNK_CACHE_VERSION, WORLD_MAP_CHUNK_CACHE_HEADER_SIZE } from '@/worlds/maps/WorldMapChunkCacheFormat';
import type { WorldMap } from '@/worlds/World';
import type { CompressedWorldMap } from '@/worlds/maps/WorldMapCodec';
import type { WorldMapChunkCache } from '@/worlds/maps/WorldMapChunkCacheCodec';

export type AnyWorldMap = WorldMap | CompressedWorldMap | WorldMapChunkCache;

function sha256Hex(input: Buffer | string): string {
  const h = crypto.createHash('sha256');
  h.update(input);

  return h.digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasNonEmptyKeys(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function hasNonEmptyBlockTypes(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;

  return false;
}

function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}

function extractOverlays(parsed: unknown): { blockTypes?: WorldMapChunkCache['blockTypes'], entities?: WorldMap['entities'] } {
  if (WorldMapCodec.isCompressedWorldMap(parsed)) {
    return {
      blockTypes: parsed.blockTypes as unknown as WorldMapChunkCache['blockTypes'],
      entities: parsed.entities,
    };
  }

  if (!isRecord(parsed)) return {};

  return {
    blockTypes: parsed.blockTypes as WorldMapChunkCache['blockTypes'] | undefined,
    entities: parsed.entities as WorldMap['entities'] | undefined,
  };
}

export default class WorldMapFileLoader {
  public static load(mapPath: string, options: { preferChunkCache?: boolean, warnings?: 'auto' | 'always' | 'never' } = {}): AnyWorldMap {
    const preferChunkCache = options.preferChunkCache ?? true;
    const absoluteMapPath = path.resolve(process.cwd(), mapPath);
    const warnings = options.warnings ?? 'auto';
    const shouldWarn = warnings === 'always' || (warnings === 'auto' && process.env.NODE_ENV !== 'production');
    const warn = (message: string) => { if (shouldWarn) ErrorHandler.warning(message); };

    if (preferChunkCache) {
      const basePath = absoluteMapPath.endsWith('.compressed.json')
        ? absoluteMapPath.slice(0, -'.compressed.json'.length)
        : absoluteMapPath.endsWith('.json')
          ? absoluteMapPath.slice(0, -'.json'.length)
          : absoluteMapPath;

      const chunkCachePath = basePath + '.chunks.bin';

      if (fs.existsSync(chunkCachePath)) {
        const raw = fs.readFileSync(chunkCachePath);

        const looksValid = raw.byteLength >= WORLD_MAP_CHUNK_CACHE_HEADER_SIZE &&
          raw.subarray(0, 8).equals(WORLD_MAP_CHUNK_CACHE_MAGIC) &&
          raw.readUInt8(8) === WORLD_MAP_CHUNK_CACHE_VERSION;

        if (looksValid) {
          const cache = { data: raw.toString('base64') };

          try {
            const metadata = WorldMapChunkCacheCodec.decodeMetadata(cache);
            const expected = metadata.source?.sha256;

            const overlayCandidates = new Set<string>();
            if (absoluteMapPath.endsWith('.json')) overlayCandidates.add(absoluteMapPath);
            overlayCandidates.add(basePath + '.compressed.json');
            overlayCandidates.add(basePath + '.json');

            let overlayEntities: WorldMap['entities'] | undefined;
            let overlayEntitiesFrom: string | undefined;
            let overlayBlockTypes: WorldMapChunkCache['blockTypes'] | undefined;
            let overlayBlockTypesFrom: string | undefined;
            for (const candidate of overlayCandidates) {
              const parsedOverlay = readJsonIfExists(candidate);
              if (!parsedOverlay) continue;

              const overlays = extractOverlays(parsedOverlay);
              if (!overlayEntities && hasNonEmptyKeys(overlays.entities)) {
                overlayEntities = overlays.entities;
                overlayEntitiesFrom = candidate;
              }
              if (!overlayBlockTypes && hasNonEmptyBlockTypes(overlays.blockTypes)) {
                overlayBlockTypes = overlays.blockTypes;
                overlayBlockTypesFrom = candidate;
              }

              if (overlayEntities && overlayBlockTypes) break;
            }

            if (expected) {
              const compressedPath = absoluteMapPath.endsWith('.compressed.json')
                ? absoluteMapPath
                : basePath + '.compressed.json';

              if (fs.existsSync(compressedPath)) {
                const compressedRaw = fs.readFileSync(compressedPath, 'utf-8');
                const actual = sha256Hex(compressedRaw);
                if (actual === expected) {
                  const shouldOverlayEntities = !hasNonEmptyKeys(metadata.entities) && overlayEntities;
                  const shouldOverlayBlockTypes = !hasNonEmptyBlockTypes(metadata.blockTypes) && overlayBlockTypes;

                  if (shouldOverlayEntities || shouldOverlayBlockTypes) {
                    if (shouldOverlayEntities && overlayEntitiesFrom) {
                      warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing entities; using entities overlay from ${overlayEntitiesFrom}.`);
                    }
                    if (shouldOverlayBlockTypes && overlayBlockTypesFrom) {
                      warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing blockTypes; using blockTypes overlay from ${overlayBlockTypesFrom}.`);
                    }

                    return {
                      ...cache,
                      ...(shouldOverlayEntities ? { entities: overlayEntities } : {}),
                      ...(shouldOverlayBlockTypes ? { blockTypes: overlayBlockTypes } : {}),
                    };
                  }

                  return cache;
                }

                warn(`WorldMapFileLoader.load(): Chunk cache sha256 mismatch for ${chunkCachePath}; ignoring cache and falling back to JSON.`);
              } else {
                warn(`WorldMapFileLoader.load(): Chunk cache has source sha256, but ${compressedPath} is missing; using cache without validation.`);

                const shouldOverlayEntities = !hasNonEmptyKeys(metadata.entities) && overlayEntities;
                const shouldOverlayBlockTypes = !hasNonEmptyBlockTypes(metadata.blockTypes) && overlayBlockTypes;

                if (shouldOverlayEntities || shouldOverlayBlockTypes) {
                  if (shouldOverlayEntities && overlayEntitiesFrom) {
                    warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing entities; using entities overlay from ${overlayEntitiesFrom}.`);
                  }
                  if (shouldOverlayBlockTypes && overlayBlockTypesFrom) {
                    warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing blockTypes; using blockTypes overlay from ${overlayBlockTypesFrom}.`);
                  }

                  return {
                    ...cache,
                    ...(shouldOverlayEntities ? { entities: overlayEntities } : {}),
                    ...(shouldOverlayBlockTypes ? { blockTypes: overlayBlockTypes } : {}),
                  };
                }

                return cache;
              }
            } else {
              // Cache has no source hash; accept cache.
              const shouldOverlayEntities = !hasNonEmptyKeys(metadata.entities) && overlayEntities;
              const shouldOverlayBlockTypes = !hasNonEmptyBlockTypes(metadata.blockTypes) && overlayBlockTypes;

              if (shouldOverlayEntities || shouldOverlayBlockTypes) {
                if (shouldOverlayEntities && overlayEntitiesFrom) {
                  warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing entities; using entities overlay from ${overlayEntitiesFrom}.`);
                }
                if (shouldOverlayBlockTypes && overlayBlockTypesFrom) {
                  warn(`WorldMapFileLoader.load(): Chunk cache at ${chunkCachePath} missing blockTypes; using blockTypes overlay from ${overlayBlockTypesFrom}.`);
                }

                return {
                  ...cache,
                  ...(shouldOverlayEntities ? { entities: overlayEntities } : {}),
                  ...(shouldOverlayBlockTypes ? { blockTypes: overlayBlockTypes } : {}),
                };
              }

              return cache;
            }
          } catch {
            warn(`WorldMapFileLoader.load(): Failed to decode chunk cache metadata for ${chunkCachePath}; ignoring cache and falling back to JSON.`);
          }
        }
      }
    }

    const raw = fs.readFileSync(absoluteMapPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (WorldMapChunkCacheCodec.isWorldMapChunkCache(parsed)) {
      return parsed;
    }

    if (WorldMapCodec.isCompressedWorldMap(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      return parsed as WorldMap;
    }

    ErrorHandler.fatalError(`WorldMapFileLoader.load(): Unsupported map file format at ${absoluteMapPath}.`);
  }
}
