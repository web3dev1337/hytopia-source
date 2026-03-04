import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-simd-compat';

type CompressedWorldMapAlgorithm = 'brotli' | 'gzip' | 'none';

type Args = {
  cwd?: string;
  mapPath: string;
  algorithm: CompressedWorldMapAlgorithm;
  level: number;
  cacheAlgorithm: CompressedWorldMapAlgorithm;
  cacheLevel: number;
  iterations: number;
  validate: boolean;
  benchE2e: boolean;
  preloadModels: boolean;
  skipEntities: boolean;
  outPath?: string;
  chunkCacheOutPath?: string;
  benchChunkCache: boolean;
};

function usage(exitCode: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage:',
    '  bun scripts/worldmap-benchmark.ts --map <path> [options]',
    '',
    'Options:',
    '  --cwd <path>             Working directory (assets/ live here)',
    '  --map <path>             Map JSON path (WorldMap or CompressedWorldMap)',
    '  --algorithm <name>       brotli | gzip | none (default: brotli)',
    '  --level <0-11>           Compression level (default: 9)',
    '  --cache-algorithm <name> brotli | gzip | none (default: brotli)',
    '  --cache-level <0-11>     Chunk cache compression level (default: 4)',
    '  --iterations <n>         Number of load iterations per format (default: 3)',
    '  --validate               Hash chunk lattice after load',
    '  --bench-e2e              Benchmark read+parse+load for each format',
    '  --preload-models         Preload all models before running',
    '  --skip-entities          Do not spawn map entities during load',
    '  --out <path>             Write compressed map JSON (when input is WorldMap)',
    '  --chunk-cache-out <path> Write chunk cache binary (.chunks.bin)',
    '  --bench-chunk-cache      Benchmark chunk cache loadMap (generated from input map)',
    '  --help                   Show help',
    '',
    'Examples:',
    '  bun scripts/worldmap-benchmark.ts --map assets/maps/boilerplate.json --validate',
    '  bun scripts/worldmap-benchmark.ts --map ../sdk-examples/big-world/assets/map.json --iterations 5',
    '  bun scripts/worldmap-benchmark.ts --cwd /path/to/game --map assets/map.json --out assets/map.compressed.json',
    '  bun scripts/worldmap-benchmark.ts --map ../sdk-examples/big-world/assets/map.json --bench-chunk-cache --chunk-cache-out ../sdk-examples/big-world/assets/map.chunks.bin',
  ].join('\n'));

  process.exit(exitCode);
}

function parseArgs(argv: string[]): Args {
  let cwd: string | undefined;
  let mapPath: string | undefined;
  let algorithm: CompressedWorldMapAlgorithm = 'brotli';
  let level = 9;
  let cacheAlgorithm: CompressedWorldMapAlgorithm = 'brotli';
  let cacheLevel = 4;
  let iterations = 3;
  let validate = false;
  let benchE2e = false;
  let preloadModels = false;
  let skipEntities = false;
  let outPath: string | undefined;
  let chunkCacheOutPath: string | undefined;
  let benchChunkCache = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);

    if (arg === '--cwd') {
      cwd = argv[++i];
      continue;
    }

    if (arg === '--map') {
      mapPath = argv[++i];
      continue;
    }

    if (arg === '--algorithm') {
      const value = argv[++i] as CompressedWorldMapAlgorithm;
      if (value !== 'brotli' && value !== 'gzip' && value !== 'none') {
        throw new Error(`Invalid --algorithm: ${value}`);
      }
      algorithm = value;
      continue;
    }

    if (arg === '--level') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0 || value > 11) {
        throw new Error(`Invalid --level: ${value}`);
      }
      level = value;
      continue;
    }

    if (arg === '--cache-algorithm') {
      const value = argv[++i] as CompressedWorldMapAlgorithm;
      if (value !== 'brotli' && value !== 'gzip' && value !== 'none') {
        throw new Error(`Invalid --cache-algorithm: ${value}`);
      }
      cacheAlgorithm = value;
      continue;
    }

    if (arg === '--cache-level') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0 || value > 11) {
        throw new Error(`Invalid --cache-level: ${value}`);
      }
      cacheLevel = value;
      continue;
    }

    if (arg === '--iterations') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Invalid --iterations: ${value}`);
      }
      iterations = value;
      continue;
    }

    if (arg === '--validate') {
      validate = true;
      continue;
    }

    if (arg === '--bench-e2e') {
      benchE2e = true;
      continue;
    }

    if (arg === '--preload-models') {
      preloadModels = true;
      continue;
    }

    if (arg === '--skip-entities') {
      skipEntities = true;
      continue;
    }

    if (arg === '--out') {
      outPath = argv[++i];
      continue;
    }

    if (arg === '--chunk-cache-out') {
      chunkCacheOutPath = argv[++i];
      continue;
    }

    if (arg === '--bench-chunk-cache') {
      benchChunkCache = true;
      continue;
    }

    throw new Error(`Unknown arg: ${arg}`);
  }

  if (!mapPath) usage(1);

  return {
    cwd,
    mapPath,
    algorithm,
    level,
    cacheAlgorithm,
    cacheLevel,
    iterations,
    validate,
    benchE2e,
    preloadModels,
    skipEntities,
    outPath,
    chunkCacheOutPath,
    benchChunkCache,
  };
}

function hrtimeMs(startNs: bigint, endNs: bigint): number {
  return Number(endNs - startNs) / 1_000_000;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
}

function readTextFileTimed(filePath: string): { text: string, ms: number, bytes: number } {
  const start = process.hrtime.bigint();
  const text = fs.readFileSync(filePath, 'utf-8');
  const end = process.hrtime.bigint();

  return {
    text,
    ms: hrtimeMs(start, end),
    bytes: Buffer.byteLength(text),
  };
}

function readBinaryFileTimed(filePath: string): { buffer: Buffer, ms: number, bytes: number } {
  const start = process.hrtime.bigint();
  const buffer = fs.readFileSync(filePath);
  const end = process.hrtime.bigint();

  return {
    buffer,
    ms: hrtimeMs(start, end),
    bytes: buffer.byteLength,
  };
}

function parseJsonTimed(text: string): { value: unknown, ms: number } {
  const start = process.hrtime.bigint();
  const value = JSON.parse(text) as unknown;
  const end = process.hrtime.bigint();

  return {
    value,
    ms: hrtimeMs(start, end),
  };
}

function median(values: number[]): number {
  const sorted = [ ...values ].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function countKeys(record: unknown): number {
  if (!record || typeof record !== 'object') return 0;
  let count = 0;
  for (const _ in record as Record<string, unknown>) count++;
  return count;
}

function hashChunkLattice(world: any): { hash: string, chunkCount: number, totalBlocks: number } {
  const chunks = world.chunkLattice.getAllChunks();
  chunks.sort((a, b) => (
    a.originCoordinate.y - b.originCoordinate.y ||
    a.originCoordinate.x - b.originCoordinate.x ||
    a.originCoordinate.z - b.originCoordinate.z
  ));

  const h = crypto.createHash('sha256');
  for (const chunk of chunks) {
    h.update(`${chunk.originCoordinate.x},${chunk.originCoordinate.y},${chunk.originCoordinate.z}|`);
    h.update(Buffer.from(chunk.blocks));

    if (chunk.blockRotations.size > 0) {
      const entries = Array.from(chunk.blockRotations.entries()).sort((a, b) => a[0] - b[0]);
      const buf = Buffer.allocUnsafe(entries.length * 3);
      let offset = 0;
      for (const [blockIndex, rot] of entries) {
        buf.writeUInt16LE(blockIndex, offset);
        offset += 2;
        buf.writeUInt8(rot.enumIndex, offset);
        offset += 1;
      }
      h.update(buf);
    }
  }

  let totalBlocks = 0;
  for (let id = 1; id <= 255; id++) {
    totalBlocks += world.chunkLattice.getBlockTypeCount(id);
  }

  return { hash: h.digest('hex'), chunkCount: chunks.length, totalBlocks };
}

function createBenchWorld(WorldCtor: any): any {
  return new WorldCtor({
    id: 1,
    name: 'benchmark',
    skyboxUri: 'skyboxes/space',
    tickRate: 60,
    gravity: { x: 0, y: -32, z: 0 },
  });
}

function benchLoadMap(
  WorldCtor: any,
  map: any,
  iterations: number,
  loadOptions: { spawnEntities: boolean },
): { timesMs: number[], lastWorld: any } {
  let lastWorld: any | undefined;
  const timesMs: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const world = createBenchWorld(WorldCtor);
    const start = process.hrtime.bigint();
    world.loadMap(map, loadOptions);
    const end = process.hrtime.bigint();
    timesMs.push(hrtimeMs(start, end));
    lastWorld = world;
  }

  return { timesMs, lastWorld: lastWorld! };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const initialCwd = process.cwd();
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultServerCwd = path.resolve(scriptDir, '..');

  if (args.cwd) {
    process.chdir(path.resolve(initialCwd, args.cwd));
  } else {
    process.chdir(defaultServerCwd);
  }

  const [
    { default: BlockTextureRegistry },
    { default: ModelRegistry },
    { default: World },
    { default: WorldMapCodec },
    { default: WorldMapChunkCacheCodec },
  ] = await Promise.all([
    import('../src/textures/BlockTextureRegistry.ts'),
    import('../src/models/ModelRegistry.ts'),
    import('../src/worlds/World.ts'),
    import('../src/worlds/maps/WorldMapCodec.ts'),
    import('../src/worlds/maps/WorldMapChunkCacheCodec.ts'),
  ]);

  // eslint-disable-next-line no-console
  console.log(`cwd: ${process.cwd()}`);

  const absoluteMapPath = path.resolve(process.cwd(), args.mapPath);
  const mapFileSize = fs.statSync(absoluteMapPath).size;

  // eslint-disable-next-line no-console
  console.log(`map: ${absoluteMapPath} (${formatBytes(mapFileSize)})`);

  const initStart = process.hrtime.bigint();
  await RAPIER.init();
  await BlockTextureRegistry.instance.preloadAtlas();
  if (args.preloadModels) {
    await ModelRegistry.instance.preloadModels();
  }
  const initEnd = process.hrtime.bigint();
  // eslint-disable-next-line no-console
  console.log(`init: ${formatMs(hrtimeMs(initStart, initEnd))}`);

  const spawnEntities = !args.skipEntities;
  const loadOptions = { spawnEntities };

  const isChunkCacheBinary = absoluteMapPath.endsWith('.chunks.bin');

  let parsed: unknown;
  let inputReadMs = 0;
  let inputParseMs = 0;
  if (isChunkCacheBinary) {
    const { buffer, ms } = readBinaryFileTimed(absoluteMapPath);
    inputReadMs = ms;
    // eslint-disable-next-line no-console
    console.log(`read: ${formatMs(ms)}`);
    // eslint-disable-next-line no-console
    console.log('parse: (binary)');
    parsed = { data: buffer.toString('base64') };
  } else {
    const { text, ms } = readTextFileTimed(absoluteMapPath);
    inputReadMs = ms;
    // eslint-disable-next-line no-console
    console.log(`read: ${formatMs(ms)}`);

    const parsedTimed = parseJsonTimed(text);
    parsed = parsedTimed.value;
    inputParseMs = parsedTimed.ms;
    // eslint-disable-next-line no-console
    console.log(`parse: ${formatMs(parsedTimed.ms)}`);
  }

  let worldMap: any | undefined;
  let compressedMap: any | undefined;
  let chunkCache: any | undefined;

  if (WorldMapChunkCacheCodec.isWorldMapChunkCache(parsed)) {
    chunkCache = parsed;
  } else if (WorldMapCodec.isCompressedWorldMap(parsed)) {
    compressedMap = parsed;
  } else {
    worldMap = parsed as WorldMap;
  }

  if (worldMap) {
    const blockCount = countKeys(worldMap.blocks);
    const originalEntityCount = countKeys(worldMap?.entities);
    const entityCountLabel = args.skipEntities && originalEntityCount > 0
      ? `${originalEntityCount.toLocaleString()} (skipped)`
      : `${originalEntityCount.toLocaleString()}`;
    // eslint-disable-next-line no-console
    console.log(`worldMap: blocks=${blockCount.toLocaleString()} blockTypes=${worldMap.blockTypes?.length ?? 0} entities=${entityCountLabel}`);

    const compressStart = process.hrtime.bigint();
    compressedMap = WorldMapCodec.compress(worldMap, { algorithm: args.algorithm, level: args.level });
    const compressEnd = process.hrtime.bigint();

    const compressedJson = JSON.stringify(compressedMap);
    const compressedSize = Buffer.byteLength(compressedJson);
    const ratio = mapFileSize === 0 ? 0 : (1 - (compressedSize / mapFileSize));

    // eslint-disable-next-line no-console
    console.log(`compress: ${formatMs(hrtimeMs(compressStart, compressEnd))} -> ${formatBytes(compressedSize)} (${(ratio * 100).toFixed(2)}% smaller)`);

    if (args.outPath) {
      const out = path.resolve(process.cwd(), args.outPath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, compressedJson);
      // eslint-disable-next-line no-console
      console.log(`wrote: ${out} (${formatBytes(fs.statSync(out).size)})`);
    }
  }

  if (!compressedMap) {
    if (!chunkCache) {
      throw new Error('Failed to resolve map input.');
    }
  }

  if (compressedMap) {
    const originalEntityCount = countKeys(compressedMap.entities);
    const entityCountLabel = args.skipEntities && originalEntityCount > 0
      ? `${originalEntityCount.toLocaleString()} (skipped)`
      : `${originalEntityCount.toLocaleString()}`;
    const blockTypesCount = compressedMap.blockTypes
      ? (Array.isArray(compressedMap.blockTypes) ? compressedMap.blockTypes.length : Object.keys(compressedMap.blockTypes).length)
      : 0;

    // eslint-disable-next-line no-console
    console.log(`compressedMap: algorithm=${compressedMap.algorithm ?? 'brotli'} rotations=${compressedMap.options?.rotations === true} blockTypes=${blockTypesCount} entities=${entityCountLabel}`);
  }

  // Size accounting: the chunk cache is typically shipped alongside a canonical map JSON.
  // eslint-disable-next-line no-console
  console.log(`sizes: input=${formatBytes(mapFileSize)}`);

  if (worldMap) {
    const jsonBenchWarmup = Math.max(0, Math.min(1, args.iterations - 1));
    if (jsonBenchWarmup > 0) {
      benchLoadMap(World, worldMap, jsonBenchWarmup, loadOptions);
    }

    const jsonBench = benchLoadMap(World, worldMap, args.iterations, loadOptions);
    const jsonMedian = median(jsonBench.timesMs);
    // eslint-disable-next-line no-console
    console.log(`loadMap WorldMap: median=${formatMs(jsonMedian)} min=${formatMs(Math.min(...jsonBench.timesMs))} max=${formatMs(Math.max(...jsonBench.timesMs))} runs=${args.iterations}`);
  }

  if (compressedMap) {
    const compressedBenchWarmup = Math.max(0, Math.min(1, args.iterations - 1));
    if (compressedBenchWarmup > 0) {
      benchLoadMap(World, compressedMap, compressedBenchWarmup, loadOptions);
    }
    const compressedBench = benchLoadMap(World, compressedMap, args.iterations, loadOptions);
    const compressedMedian = median(compressedBench.timesMs);
    // eslint-disable-next-line no-console
    console.log(`loadMap CompressedWorldMap: median=${formatMs(compressedMedian)} min=${formatMs(Math.min(...compressedBench.timesMs))} max=${formatMs(Math.max(...compressedBench.timesMs))} runs=${args.iterations}`);
  }

  if (!chunkCache && compressedMap && (args.benchChunkCache || args.chunkCacheOutPath)) {
    const cacheStart = process.hrtime.bigint();
    chunkCache = WorldMapChunkCacheCodec.create(compressedMap, {
      algorithm: args.cacheAlgorithm,
      level: args.cacheLevel,
    });
    const cacheEnd = process.hrtime.bigint();
    // eslint-disable-next-line no-console
    console.log(`chunkCache: create=${formatMs(hrtimeMs(cacheStart, cacheEnd))} algorithm=${args.cacheAlgorithm} level=${args.cacheLevel}`);
  }

  if (chunkCache) {
    const chunkCacheBytes = Buffer.from(chunkCache.data, 'base64').byteLength;
    // eslint-disable-next-line no-console
    console.log(`sizes: chunkCache=${formatBytes(chunkCacheBytes)}`);

    if (args.chunkCacheOutPath) {
      const out = path.resolve(process.cwd(), args.chunkCacheOutPath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(chunkCache.data, 'base64'));
      // eslint-disable-next-line no-console
      console.log(`wrote: ${out} (${formatBytes(fs.statSync(out).size)})`);
    }

    if (args.benchChunkCache) {
      const chunkCacheWarmup = Math.max(0, Math.min(1, args.iterations - 1));
      if (chunkCacheWarmup > 0) {
        benchLoadMap(World, chunkCache, chunkCacheWarmup, loadOptions);
      }
      const chunkCacheBench = benchLoadMap(World, chunkCache, args.iterations, loadOptions);
      const chunkCacheMedian = median(chunkCacheBench.timesMs);
      // eslint-disable-next-line no-console
      console.log(`loadMap WorldMapChunkCache: median=${formatMs(chunkCacheMedian)} min=${formatMs(Math.min(...chunkCacheBench.timesMs))} max=${formatMs(Math.max(...chunkCacheBench.timesMs))} runs=${args.iterations}`);
    }
  }

  if (args.benchE2e) {
    // eslint-disable-next-line no-console
    console.log('e2e: read+parse+load (1 run each)');

    const e2eLoad = (label: string, readMs: number, parseMs: number, mapObj: any): void => {
      const world = createBenchWorld(World);
      const loadStart = process.hrtime.bigint();
      world.loadMap(mapObj, loadOptions);
      const loadEnd = process.hrtime.bigint();
      const loadMs = hrtimeMs(loadStart, loadEnd);
      const totalMs = readMs + parseMs + loadMs;

      // eslint-disable-next-line no-console
      console.log(`e2e ${label}: read=${formatMs(readMs)} parse=${parseMs === 0 ? '(none)' : formatMs(parseMs)} loadMap=${formatMs(loadMs)} total=${formatMs(totalMs)}`);
    };

    if (worldMap) {
      e2eLoad('WorldMap', inputReadMs, inputParseMs, worldMap);
    }

    if (compressedMap) {
      if (args.outPath) {
        const out = path.resolve(process.cwd(), args.outPath);
        if (fs.existsSync(out)) {
          const { text, ms: readMs } = readTextFileTimed(out);
          const parsedTimed = parseJsonTimed(text);
          e2eLoad('CompressedWorldMap(file)', readMs, parsedTimed.ms, parsedTimed.value);
        }
      } else {
        const stringifyStart = process.hrtime.bigint();
        const json = JSON.stringify(compressedMap);
        const stringifyEnd = process.hrtime.bigint();
        const parseTimed = parseJsonTimed(json);
        const stringifyMs = hrtimeMs(stringifyStart, stringifyEnd);
        // eslint-disable-next-line no-console
        console.log(`e2e CompressedWorldMap(in-memory): stringify=${formatMs(stringifyMs)} parse=${formatMs(parseTimed.ms)} (no disk read)`);
        e2eLoad('CompressedWorldMap(in-memory)', 0, stringifyMs + parseTimed.ms, parseTimed.value);
      }
    }

    if (chunkCache) {
      if (args.chunkCacheOutPath) {
        const out = path.resolve(process.cwd(), args.chunkCacheOutPath);
        if (fs.existsSync(out)) {
          const { buffer, ms: readMs } = readBinaryFileTimed(out);
          e2eLoad('WorldMapChunkCache(file)', readMs, 0, { data: buffer.toString('base64') });
        }
      } else {
        e2eLoad('WorldMapChunkCache(in-memory)', 0, 0, chunkCache);
      }
    }

    const coldInitMs = hrtimeMs(initStart, initEnd);
    // eslint-disable-next-line no-console
    console.log(`e2e cold-start note: init=${formatMs(coldInitMs)} (add to totals for first boot)`);
  }

  if (args.validate) {
    // eslint-disable-next-line no-console
    console.log('validate: hashing chunk lattice...');

    const baselineMap = worldMap ?? compressedMap ?? chunkCache;
    if (!baselineMap) {
      throw new Error('validate: no baseline map available.');
    }

    const baseline = createBenchWorld(World);
    baseline.loadMap(baselineMap, loadOptions);
    const baselineHash = hashChunkLattice(baseline);

    const candidates: Array<{ label: string, map: any }> = [];
    if (worldMap) candidates.push({ label: 'WorldMap', map: worldMap });
    if (compressedMap) candidates.push({ label: 'CompressedWorldMap', map: compressedMap });
    if (chunkCache) candidates.push({ label: 'WorldMapChunkCache', map: chunkCache });

    for (const candidate of candidates) {
      const w = createBenchWorld(World);
      w.loadMap(candidate.map, loadOptions);
      const h = hashChunkLattice(w);
      const ok = h.hash === baselineHash.hash;
      // eslint-disable-next-line no-console
      console.log(`validate: ${candidate.label} ok=${ok} chunks=${h.chunkCount.toLocaleString()} blocks=${h.totalBlocks.toLocaleString()} hash=${h.hash}`);
    }
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
