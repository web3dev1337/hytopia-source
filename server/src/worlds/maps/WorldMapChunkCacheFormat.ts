import type { WorldMapChunkCacheAlgorithm } from '@/worlds/maps/WorldMapChunkCacheCodec';

export const WORLD_MAP_CHUNK_CACHE_MAGIC = Buffer.from('HYTCHUNK'); // 8 bytes
export const WORLD_MAP_CHUNK_CACHE_VERSION = 1;
export const WORLD_MAP_CHUNK_CACHE_HEADER_SIZE = 12;

const COMPRESSION_NONE = 0;
const COMPRESSION_BROTLI = 1;
const COMPRESSION_GZIP = 2;

export function chunkCacheAlgorithmToByte(algorithm: WorldMapChunkCacheAlgorithm): number {
  if (algorithm === 'none') return COMPRESSION_NONE;
  if (algorithm === 'gzip') return COMPRESSION_GZIP;

  return COMPRESSION_BROTLI;
}

export function chunkCacheByteToAlgorithm(value: number): WorldMapChunkCacheAlgorithm {
  if (value === COMPRESSION_NONE) return 'none';
  if (value === COMPRESSION_GZIP) return 'gzip';

  return 'brotli';
}

