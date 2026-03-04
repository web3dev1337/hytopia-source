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

            if (expected) {
              const compressedPath = absoluteMapPath.endsWith('.compressed.json')
                ? absoluteMapPath
                : basePath + '.compressed.json';

              if (fs.existsSync(compressedPath)) {
                const compressedRaw = fs.readFileSync(compressedPath, 'utf-8');
                const actual = sha256Hex(compressedRaw);
                if (actual === expected) {
                  return cache;
                }

                warn(`WorldMapFileLoader.load(): Chunk cache sha256 mismatch for ${chunkCachePath}; ignoring cache and falling back to JSON.`);
              } else {
                warn(`WorldMapFileLoader.load(): Chunk cache has source sha256, but ${compressedPath} is missing; using cache without validation.`);

                return cache;
              }
            } else {
              // Cache has no source hash; accept cache.
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
