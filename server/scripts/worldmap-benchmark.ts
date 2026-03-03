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
  iterations: number;
  validate: boolean;
  preloadModels: boolean;
  skipEntities: boolean;
  outPath?: string;
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
    '  --iterations <n>         Number of load iterations per format (default: 3)',
    '  --validate               Hash chunk lattice after load',
    '  --preload-models         Preload all models before running',
    '  --skip-entities          Do not spawn map entities during load',
    '  --out <path>             Write compressed map JSON (when input is WorldMap)',
    '  --help                   Show help',
    '',
    'Examples:',
    '  bun scripts/worldmap-benchmark.ts --map assets/maps/boilerplate.json --validate',
    '  bun scripts/worldmap-benchmark.ts --map ../sdk-examples/big-world/assets/map.json --iterations 5',
    '  bun scripts/worldmap-benchmark.ts --cwd /path/to/game --map assets/map.json --out assets/map.compressed.json',
  ].join('\n'));

  process.exit(exitCode);
}

function parseArgs(argv: string[]): Args {
  let cwd: string | undefined;
  let mapPath: string | undefined;
  let algorithm: CompressedWorldMapAlgorithm = 'brotli';
  let level = 9;
  let iterations = 3;
  let validate = false;
  let preloadModels = false;
  let skipEntities = false;
  let outPath: string | undefined;

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

    throw new Error(`Unknown arg: ${arg}`);
  }

  if (!mapPath) usage(1);

  return {
    cwd,
    mapPath,
    algorithm,
    level,
    iterations,
    validate,
    preloadModels,
    skipEntities,
    outPath,
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

function benchLoadMap(WorldCtor: any, map: any, iterations: number): { timesMs: number[], lastWorld: any } {
  let lastWorld: any | undefined;
  const timesMs: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const world = createBenchWorld(WorldCtor);
    const start = process.hrtime.bigint();
    world.loadMap(map);
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
  ] = await Promise.all([
    import('../src/textures/BlockTextureRegistry.ts'),
    import('../src/models/ModelRegistry.ts'),
    import('../src/worlds/World.ts'),
    import('../src/worlds/maps/WorldMapCodec.ts'),
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

  const readStart = process.hrtime.bigint();
  const raw = fs.readFileSync(absoluteMapPath, 'utf-8');
  const readEnd = process.hrtime.bigint();
  // eslint-disable-next-line no-console
  console.log(`read: ${formatMs(hrtimeMs(readStart, readEnd))}`);

  const parseStart = process.hrtime.bigint();
  const parsed = JSON.parse(raw) as unknown;
  const parseEnd = process.hrtime.bigint();
  // eslint-disable-next-line no-console
  console.log(`parse: ${formatMs(hrtimeMs(parseStart, parseEnd))}`);

  let worldMap: any | undefined;
  let compressedMap: any | undefined;

  if (WorldMapCodec.isCompressedWorldMap(parsed)) {
    compressedMap = parsed;
  } else {
    worldMap = parsed as WorldMap;
  }

  let effectiveWorldMap: any | undefined = worldMap;
  if (effectiveWorldMap && args.skipEntities) {
    effectiveWorldMap = {
      ...effectiveWorldMap,
      entities: undefined,
    };
  }

  if (effectiveWorldMap) {
    const blockCount = countKeys(effectiveWorldMap.blocks);
    const entityCount = countKeys(effectiveWorldMap.entities);
    // eslint-disable-next-line no-console
    console.log(`worldMap: blocks=${blockCount.toLocaleString()} blockTypes=${effectiveWorldMap.blockTypes?.length ?? 0} entities=${entityCount.toLocaleString()}`);

    const compressStart = process.hrtime.bigint();
    compressedMap = WorldMapCodec.compress(effectiveWorldMap, { algorithm: args.algorithm, level: args.level });
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
    throw new Error('Failed to resolve compressed map input.');
  }

  const effectiveCompressedMap: any = args.skipEntities
    ? { ...compressedMap, entities: undefined }
    : compressedMap;

  if (effectiveCompressedMap) {
    const entityCount = countKeys(effectiveCompressedMap.entities);
    const blockTypesCount = effectiveCompressedMap.blockTypes
      ? (Array.isArray(effectiveCompressedMap.blockTypes) ? effectiveCompressedMap.blockTypes.length : Object.keys(effectiveCompressedMap.blockTypes).length)
      : 0;

    // eslint-disable-next-line no-console
    console.log(`compressedMap: algorithm=${effectiveCompressedMap.algorithm ?? 'brotli'} rotations=${effectiveCompressedMap.options?.rotations === true} blockTypes=${blockTypesCount} entities=${entityCount.toLocaleString()}`);
  }

  if (effectiveWorldMap) {
    const jsonBenchWarmup = Math.max(0, Math.min(1, args.iterations - 1));
    if (jsonBenchWarmup > 0) {
      benchLoadMap(World, effectiveWorldMap, jsonBenchWarmup);
    }

    const jsonBench = benchLoadMap(World, effectiveWorldMap, args.iterations);
    const jsonMedian = median(jsonBench.timesMs);
    // eslint-disable-next-line no-console
    console.log(`loadMap WorldMap: median=${formatMs(jsonMedian)} min=${formatMs(Math.min(...jsonBench.timesMs))} max=${formatMs(Math.max(...jsonBench.timesMs))} runs=${args.iterations}`);
  }

  const compressedBenchWarmup = Math.max(0, Math.min(1, args.iterations - 1));
  if (compressedBenchWarmup > 0) {
    benchLoadMap(World, effectiveCompressedMap, compressedBenchWarmup);
  }
  const compressedBench = benchLoadMap(World, effectiveCompressedMap, args.iterations);
  const compressedMedian = median(compressedBench.timesMs);
  // eslint-disable-next-line no-console
  console.log(`loadMap CompressedWorldMap: median=${formatMs(compressedMedian)} min=${formatMs(Math.min(...compressedBench.timesMs))} max=${formatMs(Math.max(...compressedBench.timesMs))} runs=${args.iterations}`);

  if (args.validate && effectiveWorldMap) {
    // eslint-disable-next-line no-console
    console.log('validate: hashing chunk lattice...');

    const a = createBenchWorld(World);
    a.loadMap(effectiveWorldMap);
    const aHash = hashChunkLattice(a);

    const b = createBenchWorld(World);
    b.loadMap(effectiveCompressedMap);
    const bHash = hashChunkLattice(b);

    const ok = aHash.hash === bHash.hash;
    // eslint-disable-next-line no-console
    console.log(`validate: ok=${ok} chunks=${aHash.chunkCount}/${bHash.chunkCount} blocks=${aHash.totalBlocks.toLocaleString()}/${bHash.totalBlocks.toLocaleString()}`);
    // eslint-disable-next-line no-console
    console.log(`validate: worldMapHash=${aHash.hash}`);
    // eslint-disable-next-line no-console
    console.log(`validate: compressedHash=${bHash.hash}`);
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
