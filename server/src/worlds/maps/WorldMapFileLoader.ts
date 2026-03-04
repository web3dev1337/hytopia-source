import fs from 'fs';
import path from 'path';
import ErrorHandler from '@/errors/ErrorHandler';
import WorldMapCodec from '@/worlds/maps/WorldMapCodec';
import WorldMapChunkCacheCodec from '@/worlds/maps/WorldMapChunkCacheCodec';
import type { WorldMap } from '@/worlds/World';
import type { CompressedWorldMap } from '@/worlds/maps/WorldMapCodec';
import type { WorldMapChunkCache } from '@/worlds/maps/WorldMapChunkCacheCodec';

export type AnyWorldMap = WorldMap | CompressedWorldMap | WorldMapChunkCache;

const CHUNK_CACHE_MAGIC = Buffer.from('HYTCHUNK');
const CHUNK_CACHE_VERSION = 1;

export default class WorldMapFileLoader {
  public static load(mapPath: string, options: { preferChunkCache?: boolean } = {}): AnyWorldMap {
    const preferChunkCache = options.preferChunkCache ?? true;
    const absoluteMapPath = path.resolve(process.cwd(), mapPath);

    if (preferChunkCache) {
      const chunkCachePath = absoluteMapPath.endsWith('.json')
        ? absoluteMapPath.slice(0, -'.json'.length) + '.chunks.bin'
        : absoluteMapPath + '.chunks.bin';

      if (fs.existsSync(chunkCachePath)) {
        const raw = fs.readFileSync(chunkCachePath);

        const looksValid = raw.byteLength >= 12 &&
          raw.subarray(0, 8).equals(CHUNK_CACHE_MAGIC) &&
          raw.readUInt8(8) === CHUNK_CACHE_VERSION;

        if (looksValid) {
          return { data: raw.toString('base64') };
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
