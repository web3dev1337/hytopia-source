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
    const isExplicitChunkCache = absoluteMapPath.endsWith('.chunks.bin');
    const warnings = options.warnings ?? 'auto';
    const shouldWarn = warnings === 'always' || (warnings === 'auto' && process.env.NODE_ENV !== 'production');
    const warn = (message: string) => { if (shouldWarn) ErrorHandler.warning(message); };

    if (preferChunkCache) {
      if (isExplicitChunkCache && !fs.existsSync(absoluteMapPath)) {
        ErrorHandler.fatalError(`WorldMapFileLoader.load(): Chunk cache file not found at ${absoluteMapPath}.`);
      }

      let basePath = absoluteMapPath;
      if (absoluteMapPath.endsWith('.compressed.json')) {
        basePath = absoluteMapPath.slice(0, -'.compressed.json'.length);
      } else if (absoluteMapPath.endsWith('.chunks.bin')) {
        basePath = absoluteMapPath.slice(0, -'.chunks.bin'.length);
      } else if (absoluteMapPath.endsWith('.json')) {
        basePath = absoluteMapPath.slice(0, -'.json'.length);
      }

      const chunkCachePath = basePath + '.chunks.bin';

      if (fs.existsSync(chunkCachePath)) {
        const raw = fs.readFileSync(chunkCachePath);

        const looksValid = raw.byteLength >= WORLD_MAP_CHUNK_CACHE_HEADER_SIZE &&
          raw.subarray(0, 8).equals(WORLD_MAP_CHUNK_CACHE_MAGIC) &&
          raw.readUInt8(8) === WORLD_MAP_CHUNK_CACHE_VERSION;

        if (looksValid) {
          const cache: WorldMapChunkCache = { data: raw.toString('base64') };

          try {
            const metadata = WorldMapChunkCacheCodec.decodeMetadata(cache);
            const expected = metadata.source?.sha256;

            const needsEntityOverlay = !hasNonEmptyKeys(metadata.entities);
            const needsBlockTypesOverlay = !hasNonEmptyBlockTypes(metadata.blockTypes);
            const needsOverlays = needsEntityOverlay || needsBlockTypesOverlay;

            let overlayEntities: WorldMap['entities'] | undefined;
            let overlayEntitiesFrom: string | undefined;
            let overlayBlockTypes: WorldMapChunkCache['blockTypes'] | undefined;
            let overlayBlockTypesFrom: string | undefined;

            const applyOverlays = (): WorldMapChunkCache => {
              const shouldOverlayEntities = needsEntityOverlay && overlayEntities;
              const shouldOverlayBlockTypes = needsBlockTypesOverlay && overlayBlockTypes;

              if (!shouldOverlayEntities && !shouldOverlayBlockTypes) return cache;

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
            };

            const loadOverlaysFromPath = (candidatePath: string): void => {
              if (!needsOverlays) return;

              const parsedOverlay = readJsonIfExists(candidatePath);
              if (!parsedOverlay) return;

              const overlays = extractOverlays(parsedOverlay);

              if (!overlayEntities && hasNonEmptyKeys(overlays.entities)) {
                overlayEntities = overlays.entities;
                overlayEntitiesFrom = candidatePath;
              }
              if (!overlayBlockTypes && hasNonEmptyBlockTypes(overlays.blockTypes)) {
                overlayBlockTypes = overlays.blockTypes;
                overlayBlockTypesFrom = candidatePath;
              }
            };

            const loadOverlaysFromCompressedRaw = (compressedRaw: string, candidatePath: string): void => {
              if (!needsOverlays) return;

              try {
                const parsedOverlay = JSON.parse(compressedRaw) as unknown;
                const overlays = extractOverlays(parsedOverlay);
                if (!overlayEntities && hasNonEmptyKeys(overlays.entities)) {
                  overlayEntities = overlays.entities;
                  overlayEntitiesFrom = candidatePath;
                }
                if (!overlayBlockTypes && hasNonEmptyBlockTypes(overlays.blockTypes)) {
                  overlayBlockTypes = overlays.blockTypes;
                  overlayBlockTypesFrom = candidatePath;
                }
              } catch {
                // Ignore overlay parse failures.
              }
            };

            if (expected) {
              const compressedPath = absoluteMapPath.endsWith('.compressed.json')
                ? absoluteMapPath
                : basePath + '.compressed.json';

              if (fs.existsSync(compressedPath)) {
                const compressedRaw = fs.readFileSync(compressedPath, 'utf-8');
                const actual = sha256Hex(compressedRaw);
                if (actual === expected) {
                  loadOverlaysFromCompressedRaw(compressedRaw, compressedPath);

                  return applyOverlays();
                }

                warn(`WorldMapFileLoader.load(): Chunk cache sha256 mismatch for ${chunkCachePath}; ignoring cache and falling back to JSON.`);
              } else {
                warn(`WorldMapFileLoader.load(): Chunk cache has source sha256, but ${compressedPath} is missing; using cache without validation.`);

                loadOverlaysFromPath(basePath + '.compressed.json');
                loadOverlaysFromPath(basePath + '.json');

                return applyOverlays();
              }
            } else {
              // Cache has no source hash; accept cache.
              loadOverlaysFromPath(basePath + '.compressed.json');
              loadOverlaysFromPath(basePath + '.json');

              return applyOverlays();
            }
          } catch {
            if (isExplicitChunkCache) {
              ErrorHandler.fatalError(`WorldMapFileLoader.load(): Failed to decode chunk cache metadata for ${chunkCachePath}.`);
            }

            warn(`WorldMapFileLoader.load(): Failed to decode chunk cache metadata for ${chunkCachePath}; ignoring cache and falling back to JSON.`);
          }
        } else if (isExplicitChunkCache) {
          ErrorHandler.fatalError(`WorldMapFileLoader.load(): Invalid chunk cache at ${chunkCachePath}.`);
        }
      }
    }

    if (isExplicitChunkCache) {
      ErrorHandler.fatalError(`WorldMapFileLoader.load(): Failed to load chunk cache at ${absoluteMapPath}.`);
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
