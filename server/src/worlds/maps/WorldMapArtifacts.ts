import crypto from 'crypto';
import WorldMapCodec from '@/worlds/maps/WorldMapCodec';
import WorldMapChunkCacheCodec from '@/worlds/maps/WorldMapChunkCacheCodec';
import type { WorldMap } from '@/worlds/World';
import type { CompressedWorldMap, CompressWorldMapOptions } from '@/worlds/maps/WorldMapCodec';
import type { WorldMapChunkCache, CreateWorldMapChunkCacheOptions } from '@/worlds/maps/WorldMapChunkCacheCodec';

export type WorldMapArtifacts = {
  compressedMap: CompressedWorldMap;
  compressedMapJson: string;
  compressedMapSha256: string;
  chunkCache: WorldMapChunkCache;
  chunkCacheBuffer: Buffer;
};

function sha256Hex(input: string | Buffer): string {
  const h = crypto.createHash('sha256');
  h.update(input);

  return h.digest('hex');
}

export default class WorldMapArtifactsGenerator {
  public static create(
    worldMap: WorldMap,
    options: {
      compressed?: CompressWorldMapOptions;
      chunkCache?: Omit<CreateWorldMapChunkCacheOptions, 'sourceSha256'>;
    } = {},
  ): WorldMapArtifacts {
    const compressedMap = WorldMapCodec.compress(worldMap, options.compressed);
    const compressedMapJson = JSON.stringify(compressedMap);
    const compressedMapSha256 = sha256Hex(compressedMapJson);
    const chunkCache = WorldMapChunkCacheCodec.create(compressedMap, {
      ...options.chunkCache,
      sourceSha256: compressedMapSha256,
    });
    const chunkCacheBuffer = Buffer.from(chunkCache.data, 'base64');

    return {
      compressedMap,
      compressedMapJson,
      compressedMapSha256,
      chunkCache,
      chunkCacheBuffer,
    };
  }
}
