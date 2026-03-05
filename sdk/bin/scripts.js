#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import crypto from 'crypto';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import nodemon from 'nodemon';
import readline from 'readline';
import { fileURLToPath } from 'url';

// Store command-line flags
const flags = {};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Main function to handle command execution
(async () => {
  const command = process.argv[2];
  
  // Check for version flags first (before parsing other flags)
  if (command === '-v' || command === '--version') {
    displayVersion();
    return;
  }
  
  // Help command/flags
  if (command === '-h' || command === '--help') {
    displayHelp();
    return;
  }
    
  // Parse command-line flags
  parseCommandLineFlags();
  
  // Execute the appropriate command
  const commandHandlers = {
    'build': () => build(false, process.argv[3]),
    'build-dev': () => build(true, process.argv[3]),
    'help': displayHelp,
    'init': init,
    'init-mcp': initMcp,
    'map-compress': mapCompress,
    'package': packageProject,
    'run': run,
    'start': start,
    'upgrade-assets-library': () => upgradeAssetsLibrary(process.argv[3] || 'latest'),
    'upgrade-cli': () => upgradeCli(process.argv[3] || 'latest'),
    'upgrade-project': () => upgradeProject(process.argv[3] || 'latest'),
    'version': displayVersion,
  };

  const handler = commandHandlers[command];
  
  if (handler) {
    await Promise.resolve(handler());
  } else {
    displayAvailableCommands(command);
  }
})();

// ================================================================================
// COMMAND IMPLEMENTATIONS
// ================================================================================

/**
 * Build command
 * 
 * Builds the server and client code for node.js
 * 
 * @example
 */

/**
 * Runs a hytopia project's index file using node.js
 * and watches for changes.
 */
async function start() {
  const projectRoot = process.cwd();
  const inputFile = process.argv[3] || 'index.ts';
  const outputFile = inputFile.replace(/\.ts$/, '.mjs');
  const entryFile = path.join(projectRoot, outputFile);
  const buildCmd = `hytopia build-dev ${inputFile}`;
  const runCmd = `"${process.execPath}" --enable-source-maps "${entryFile}"`;

  // Auto-recompress map if stale before first build
  autoRecompressMap();

  // Start nodemon to watch for changes, rebuild, then run the server
  nodemon({
    watch: ['.'],
    ext: 'js,ts,html,json,bin',
    ignore: ['node_modules/**', '.git/**', '*.zip', outputFile, 'assets/map.compressed.json', 'assets/map.chunks.bin'],
    exec: `${buildCmd} && ${runCmd}`,
    delay: 100,
  })
  .on('restart', () => {
    autoRecompressMap();
  })
  .on('quit', () => {
    console.log('👋 Shutting down...');
    process.exit();
  });
}

/**
 * Run command
 * 
 * Builds and runs the project once without file watching.
 * Useful for debugging, testing, or production-like runs.
 * 
 * @example
 * `hytopia run`
 * `hytopia run playground.ts`
 */
async function run() {
  const projectRoot = process.cwd();
  const inputFile = process.argv[3] || 'index.ts';
  const outputFile = inputFile.replace(/\.ts$/, '.mjs');
  const entryFile = path.join(projectRoot, outputFile);

  await build(true, inputFile);

  execSync(`"${process.execPath}" --enable-source-maps "${entryFile}"`, {
    stdio: 'inherit',
    cwd: projectRoot,
  });
}

/**
 * Version command
 * 
 * Displays the version of the HYTOPIA SDK by reading
 * from the package.json file.
 * 
 * @example
 * `hytopia version`
 * `hytopia -v`
 * `hytopia --version`
 */
function displayVersion() {
  const localVersion = getLocalVersion();

  if (localVersion) {
    console.log(localVersion);
  } else {
    console.error('❌ Error: Could not read package version');
    process.exit(1);
  }
}

/**
 * Init command
 * 
 * Initializes a new HYTOPIA project. Accepting an optional
 * project name as an argument.
 * 
 * @example
 * `hytopia init my-project-name`
 */
function init() {
  const destDir = process.cwd();

  console.log('⚙️ Installing core dependencies...');

  // Install dependencies
  installProjectDependencies();

  // Initialize project with latest HYTOPIA SDK
  console.log('🔧 Initializing project with latest HYTOPIA SDK...');
 
  if (flags.template) {
    initFromTemplate(destDir);
  } else {
    initFromBoilerplate(destDir);
  }

  // Update SDK to latest (sets package.json requirement)
  upgradeProject();

  // Display success message
  displayInitSuccessMessage();

  // Prompt for MCP setup
  promptForMcpSetup();

  return;
}

/**
 * Installs required dependencies for a new project
 */
function installProjectDependencies() {
  // init project
  execSync('npm init -y --silent --loglevel silent', { stdio: ['ignore', 'ignore', 'inherit'] });
  
  // Add various common scripts to the package.json
  execSync('npm pkg set scripts.build="hytopia build"', { stdio: 'ignore' });
  execSync('npm pkg set scripts.package="hytopia package"', { stdio: 'ignore' });
  execSync('npm pkg set scripts.upgrade-assets-library="hytopia upgrade-assets-library"', { stdio: 'ignore' });
  execSync('npm pkg set scripts.upgrade-project="hytopia upgrade-project"', { stdio: 'ignore' });

  // create tsconfig.json, used by build
  fs.writeFileSync('tsconfig.json', JSON.stringify({
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "node",
      verbatimModuleSyntax: true,
      strict: true,
      skipLibCheck: true
    }
  }, null, 2))

  // install dev dependencies
  execSync('npm install --save-dev typescript', { stdio: 'inherit' });

  // install hytopia sdk and hytopia assets
  execSync('npm install --force hytopia@latest', { stdio: 'inherit' });
  execSync('npm install --save-optional --force @hytopia.com/assets@latest', { stdio: 'inherit' });
}

/**
 * Initializes a project from a template
 */
function initFromTemplate(destDir) {
  console.log(`🖨️  Initializing project with examples template "${flags.template}"...`);

  execSync('npm install --force @hytopia.com/examples@latest', { stdio: 'inherit' });

  const templateDir = path.join(destDir, 'node_modules', '@hytopia.com', 'examples', flags.template);

  if (!copyDirectoryContents(templateDir, destDir)) {
    console.error(`❌ Examples template ${flags.template} does not exist in the @hytopia.com/examples package, could not initialize project!`);
    console.error(`   Tried directory: ${templateDir}`);
    return;
  }

  execSync('npm install', { stdio: 'inherit' });
}

/**
 * Initializes a project from the default boilerplate
 */
function initFromBoilerplate(destDir) {
  console.log('🧑‍💻 Initializing project with boilerplate...');
  const srcDir = path.join(__dirname, '..', 'boilerplate');
  
  if (!copyDirectoryContents(srcDir, destDir)) {
    console.error('❌ Error: Could not copy boilerplate files');
    process.exit(1);
  }
}

/**
 * Displays success message after project initialization
 */
function displayInitSuccessMessage() {
  logDivider();
  console.log('✅ HYTOPIA PROJECT INITIALIZED SUCCESSFULLY!');
  console.log(' ');
  console.log('💡 1. Start your development server by running the command `hytopia start`');
  console.log('🎮 2. Play your game by opening: https://hytopia.com/play/?join=localhost:8080');
  logDivider();
}

/**
 * Prompts the user to set up MCP
 */
function promptForMcpSetup() {
  console.log('📋 OPTIONAL: HYTOPIA MCP SETUP');
  console.log(' ');
  console.log('The HYTOPIA MCP enables Cursor and Claude Code editors to access');
  console.log('HYTOPIA-specific capabilities, providing significantly better AI');
  console.log('assistance and development experience for this HYTOPIA project.');
  console.log(' ');

  const rl = createReadlineInterface();
  
  rl.question('Would you like to initialize the HYTOPIA MCP for this project? (y/n): ', (answer) => {
    rl.close();

    if (answer.trim().toLowerCase() === 'y') {
      initMcp();
    } else {
      logDivider();
      console.log('🎉 You\'re all set! Your HYTOPIA project is ready to use.');
      console.log('You can start your project server by running the command: hytopia start');
      logDivider();
    }
  });
}

/**
 * Initializes the MCP for the selected editors
 */
function initMcp() {
  const rl = createReadlineInterface();

  logDivider();
  console.log('🤖 HYTOPIA MCP SETUP');
  console.log('Please select your code editor:');
  console.log('  1. Cursor');
  console.log('  2. Claude Code');
  console.log('  3. Both');
  console.log('  4. None / Cancel');

  rl.question('Enter your selection (1-4): ', (answer) => {
    const selection = parseInt(answer.trim());
    
    if (isNaN(selection) || selection < 1 || selection > 4) {
      console.log('❌ Invalid selection. Please run `hytopia init-mcp` again and select a number between 1 and 4.');
      rl.close();
      return;
    }
    
    if ([1, 2, 3].includes(selection)) { logDivider(); }

    if (selection === 1 || selection === 3) {
      initCursorLocalMcp();
    }

    if (selection === 2 || selection === 3) {
      initClaudeCodeMcp();
    }
    
    rl.close();
    
    if ([1, 2, 3].includes(selection)) {
      console.log('🎉 You\'re all set! Your HYTOPIA project is ready to use.');
      console.log('You can start your project server by running the command: hytopia start');
      logDivider();
    }
  });
}

function initClaudeCodeMcp() {
  console.log('🔧 Initializing HYTOPIA MCP for Claude Code...');
  try {
    execSync('claude mcp add hytopia-mcp -s project --transport http https://ai.hytopia.com/mcp', { stdio: 'inherit' });
  } catch (err) {
    console.log('⚠️ Could not add MCP via claude CLI, falling back to manual config...');
    const claudeDir = path.join(process.cwd(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir);
    }
    fs.writeFileSync(path.join(claudeDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'hytopia-mcp': {
          url: 'https://ai.hytopia.com/mcp'
        }
      }
    }, null, 2));
  }
  console.log(`✅ Claude Code MCP initialized successfully!`);
  logDivider();
}

function initCursorLocalMcp() {
  console.log('🔧 Initializing HYTOPIA MCP for Cursor...');
  const cursorDir = path.join(process.cwd(), '.cursor');
  if (!fs.existsSync(cursorDir)) {
    fs.mkdirSync(cursorDir);
  }
  fs.writeFileSync(path.join(cursorDir, 'mcp.json'), JSON.stringify({
    mcpServers: {
      'hytopia-mcp': {
        url: 'https://ai.hytopia.com/mcp'
      }
    }
  }, null, 2));

  console.log(`✅ Cursor MCP initialized successfully!`);
  logDivider();
}

/**
 * Package command
 * 
 * Creates a zip file of the project directory, excluding node_modules
 * and package-lock.json files.
 * 
 * @example
 * `hytopia package`
 */
async function packageProject() {
  const sourceDir = process.cwd();
  const projectName = path.basename(sourceDir);
  const packageJsonPath = path.join(sourceDir, 'package.json');
  
  // Check if package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ Error: package.json not found. This directory does not appear to be a HYTOPIA project.');
    console.error('   Please run this command in a valid HYTOPIA project directory.');
    return;
  }
  
  // Check if package.json contains "hytopia"
  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    if (!packageJsonContent.includes('hytopia')) {
      console.error('❌ Error: This directory does not appear to be a HYTOPIA project.');
      console.error('   The package.json file does not contain a reference to HYTOPIA.');
      return;
    }
  } catch (err) {
    console.error('❌ Error: Could not read package.json file:', err.message);
    return;
  }

  // Build the project
  await build();

  // Test server startup & make sure optimizer has ran
  console.log('🧪 Testing server startup and making sure optimizer has ran...');
  
  logDivider();
  
  const entryFile = path.join(sourceDir, 'index.mjs');
  const child = spawn(process.execPath, [entryFile], {
    stdio: ['ignore', 'pipe', 'inherit'], // stdin ignored, stdout piped (to check for ready), stderr inherited (shows warnings/errors)
    shell: false,
    cwd: sourceDir,
  });

  await new Promise(resolve => {
    child.stdout.on('data', data => {
      process.stdout.write(data);

      if (data.toString().toLowerCase().includes('server running')) {
        child.kill();
        resolve();
      }
    });
  });

  logDivider();

  // Prepare to package
  const outputFile = path.join(sourceDir, `${projectName}.zip`);
  
  console.log(`📦 Packaging project "${projectName}"...`);

  // Create a file to stream archive data to
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level
  });
  
  // Listen for all archive data to be written
  output.on('close', function() {
    console.log(`✅ Project packaged successfully! (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`📁 Package saved to: ${outputFile}`);
  });
  
  // Good practice to catch warnings (ie stat failures and other non-blocking errors)
  archive.on('warning', function(err) {
    if (err.code === 'ENOENT') {
      console.warn('⚠️ Warning:', err);
    } else {
      throw err;
    }
  });
  
  // Catch errors
  archive.on('error', function(err) {
    console.error('❌ Error during packaging:', err);
    throw err;
  });
  
  // Pipe archive data to the file
  archive.pipe(output);
  
  // Get all files and directories in the source directory
  const items = fs.readdirSync(sourceDir);
  
  // Files/directories to exclude
  const excludeItems = [
    '.git',
    'node_modules',
    'package-lock.json',
    `${projectName}.zip` // Exclude the output file itself
  ];
  
  // Add each item to the archive, excluding the ones in the exclude list
  items.forEach(item => {
    const itemPath = path.join(sourceDir, item);
    
    if (!excludeItems.includes(item)) {
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        archive.directory(itemPath, item);
      } else {
        archive.file(itemPath, { name: item });
      }
    }
  });
  
  // Finalize the archive
  archive.finalize();
}

/**
 * Auto-recompress map if compressed artifacts are stale.
 * Called by `hytopia start` before each build cycle.
 * Only acts if compressed artifacts already exist (i.e. user has run map-compress before).
 */
function autoRecompressMap() {
  const mapPath = path.resolve(process.cwd(), 'assets/map.json');
  const compressedPath = path.resolve(process.cwd(), 'assets/map.compressed.json');
  const chunkCachePath = path.resolve(process.cwd(), 'assets/map.chunks.bin');

  if (!fs.existsSync(mapPath)) return;

  const compressedExists = fs.existsSync(compressedPath);
  const chunkCacheExists = fs.existsSync(chunkCachePath);
  if (!compressedExists && !chunkCacheExists) return;

  const mapMtime = fs.statSync(mapPath).mtimeMs;
  const compressedMtime = compressedExists ? fs.statSync(compressedPath).mtimeMs : 0;

  if (compressedMtime >= mapMtime) return;

  console.log('📦 map.json changed — recompressing...');

  try {
    const rawText = fs.readFileSync(mapPath, 'utf-8');
    const parsed = JSON.parse(rawText);

    if (parsed && typeof parsed === 'object' && typeof parsed.data === 'string' && parsed.bounds) return;

    const compressed = compressWorldMap(parsed, { algorithm: 'brotli', level: 9 });
    const compressedJson = JSON.stringify(compressed);
    const inputSize = Buffer.byteLength(rawText);
    const compressedSize = Buffer.byteLength(compressedJson);

    fs.writeFileSync(compressedPath, compressedJson);

    const sha256 = crypto.createHash('sha256').update(compressedJson).digest('hex');
    const chunkCacheBuffer = createChunkCache(compressed, { algorithm: 'brotli', level: 6, sourceSha256: sha256 });
    fs.writeFileSync(chunkCachePath, chunkCacheBuffer);

    const ratio = ((1 - (compressedSize / inputSize)) * 100).toFixed(1);
    console.log(`   ✅ Recompressed: ${formatSize(compressedSize)} (${ratio}% smaller) + ${formatSize(chunkCacheBuffer.byteLength)} chunk cache`);
  } catch (err) {
    console.error(`   ⚠️ Auto-recompress failed: ${err.message}`);
  }
}

/**
 * Map compress command
 *
 * Compresses a WorldMap JSON into optimized formats for faster loading
 * and smaller file sizes.
 *
 * @example
 * `hytopia map-compress`
 * `hytopia map-compress assets/map.json`
 * `hytopia map-compress assets/map.json --algorithm brotli --level 9`
 * `hytopia map-compress assets/map.json --no-chunk-cache`
 */
async function mapCompress() {
  const mapPath = process.argv[3] || 'assets/map.json';
  const absoluteMapPath = path.resolve(process.cwd(), mapPath);

  if (!fs.existsSync(absoluteMapPath)) {
    console.error(`❌ Map file not found: ${absoluteMapPath}`);
    process.exit(1);
  }

  const algorithm = flags['algorithm'] || 'brotli';
  const level = flags['level'] !== undefined ? Number(flags['level']) : 9;
  const cacheLevel = flags['cache-level'] !== undefined ? Number(flags['cache-level']) : 6;
  const noChunkCache = process.argv.includes('--no-chunk-cache');

  if (!['brotli', 'gzip', 'none'].includes(algorithm)) {
    console.error(`❌ Invalid algorithm: ${algorithm}. Must be brotli, gzip, or none.`);
    process.exit(1);
  }

  // Derive output paths from input path
  const basePath = absoluteMapPath.endsWith('.json')
    ? absoluteMapPath.slice(0, -'.json'.length)
    : absoluteMapPath;
  const compressedOutPath = basePath + '.compressed.json';
  const chunkCacheOutPath = basePath + '.chunks.bin';

  console.log(`📦 Compressing map: ${mapPath}`);

  // Read and parse input
  const rawText = fs.readFileSync(absoluteMapPath, 'utf-8');
  const inputSize = Buffer.byteLength(rawText);
  const parsed = JSON.parse(rawText);

  // Detect format
  const isCompressed = parsed && typeof parsed === 'object' &&
    typeof parsed.data === 'string' && parsed.bounds &&
    typeof parsed.bounds.minX === 'number';

  if (isCompressed) {
    console.error('❌ Input file is already a compressed map. Provide the original map.json.');
    process.exit(1);
  }

  const blocks = parsed.blocks || {};
  const blockCount = Object.keys(blocks).length;
  console.log(`   Input: ${formatSize(inputSize)} (${blockCount.toLocaleString()} blocks)`);

  // Compress the map
  const compressStart = performance.now();
  const compressed = compressWorldMap(parsed, { algorithm, level });
  const compressMs = performance.now() - compressStart;
  const compressedJson = JSON.stringify(compressed);
  const compressedSize = Buffer.byteLength(compressedJson);

  fs.writeFileSync(compressedOutPath, compressedJson);
  const ratio = ((1 - (compressedSize / inputSize)) * 100).toFixed(1);
  console.log(`   Compressed: ${formatSize(compressedSize)} (${ratio}% smaller) [${compressMs.toFixed(0)}ms]`);
  console.log(`   ✅ ${path.relative(process.cwd(), compressedOutPath)}`);

  // Generate chunk cache
  if (!noChunkCache) {
    const sha256 = crypto.createHash('sha256').update(compressedJson).digest('hex');

    const cacheStart = performance.now();
    const chunkCacheBuffer = createChunkCache(compressed, {
      algorithm,
      level: cacheLevel,
      sourceSha256: sha256,
    });
    const cacheMs = performance.now() - cacheStart;

    fs.writeFileSync(chunkCacheOutPath, chunkCacheBuffer);
    console.log(`   Chunk cache: ${formatSize(chunkCacheBuffer.byteLength)} [${cacheMs.toFixed(0)}ms]`);
    console.log(`   ✅ ${path.relative(process.cwd(), chunkCacheOutPath)}`);
  }

  logDivider();
  console.log('Done! Your game will automatically use these files when the');
  console.log('SDK detects them alongside your map.json.');
}

// -- map-compress codec helpers (self-contained, no server.mjs import) --

function compressWorldMap(map, options = {}) {
  const blocks = map.blocks || {};
  const entries = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let hasRotations = false;

  for (const key in blocks) {
    const val = blocks[key];
    const id = typeof val === 'number' ? val : val.i;
    const r = typeof val === 'number' ? 0 : (val.r || 0);
    if (r !== 0) hasRotations = true;

    const i1 = key.indexOf(',');
    const i2 = key.indexOf(',', i1 + 1);
    const x = Number(key.slice(0, i1));
    const y = Number(key.slice(i1 + 1, i2));
    const z = Number(key.slice(i2 + 1));

    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    entries.push({ x, y, z, id, r });
  }

  if (entries.length === 0) {
    const empty = Buffer.allocUnsafe(4);
    empty.writeUInt32LE(0, 0);
    return {
      format: 'hytopia.worldmap.compressed', codecVersion: 1, version: '1.0.0',
      algorithm: options.algorithm || 'brotli',
      data: compressBuffer(options.algorithm || 'brotli', empty, options.level || 9).toString('base64'),
      bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
      blockTypes: map.blockTypes, entities: map.entities,
      options: { rotations: false, useDelta: true, useVarint: true },
    };
  }

  const includeRotations = options.includeRotations !== undefined ? options.includeRotations : hasRotations;

  for (const b of entries) { b.x -= minX; b.y -= minY; b.z -= minZ; }
  entries.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);

  const budget = includeRotations ? 25 : 20;
  const buffer = Buffer.allocUnsafe(4 + entries.length * budget);
  let offset = 0;
  buffer.writeUInt32LE(entries.length, offset); offset += 4;

  let lastX = 0, lastY = 0, lastZ = 0;
  for (const b of entries) {
    offset = writeSignedVarint(buffer, offset, b.x - lastX);
    offset = writeSignedVarint(buffer, offset, b.y - lastY);
    offset = writeSignedVarint(buffer, offset, b.z - lastZ);
    offset = writeSignedVarint(buffer, offset, b.id);
    if (includeRotations) offset = writeSignedVarint(buffer, offset, b.r);
    lastX = b.x; lastY = b.y; lastZ = b.z;
  }

  const algo = options.algorithm || 'brotli';
  const lvl = options.level || 9;

  return {
    format: 'hytopia.worldmap.compressed', codecVersion: 1, version: '1.0.0',
    algorithm: algo,
    data: compressBuffer(algo, buffer.subarray(0, offset), lvl).toString('base64'),
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
    blockTypes: map.blockTypes, entities: map.entities,
    options: { rotations: includeRotations, useDelta: true, useVarint: true },
  };
}

function createChunkCache(compressedMap, options = {}) {
  const CHUNK_SIZE = 16;
  const CHUNK_VOLUME = CHUNK_SIZE ** 3;
  const CHUNK_SIZE_BITS = 4; // log2(16)
  const CHUNK_AXES_RANGE = 15;

  const algo = compressedMap.algorithm || 'brotli';
  const includeRotations = compressedMap.options?.rotations === true;
  const compressedBuffer = Buffer.from(compressedMap.data, 'base64');
  const decompressed = decompressBuffer(algo, compressedBuffer);

  const bounds = compressedMap.bounds;
  let readOffset = 0;
  const blockCount = decompressed.readUInt32LE(readOffset); readOffset += 4;

  const chunksByKey = new Map();
  let hasRotations = false;
  let lastX = 0, lastY = 0, lastZ = 0;

  for (let i = 0; i < blockCount; i++) {
    let r = readVarintFromBuf(decompressed, readOffset);
    lastX += decodeZigzag(r.value); readOffset = r.offset;
    r = readVarintFromBuf(decompressed, readOffset);
    lastY += decodeZigzag(r.value); readOffset = r.offset;
    r = readVarintFromBuf(decompressed, readOffset);
    lastZ += decodeZigzag(r.value); readOffset = r.offset;
    r = readVarintFromBuf(decompressed, readOffset);
    const blockTypeId = decodeZigzag(r.value); readOffset = r.offset;

    let rotIdx = 0;
    if (includeRotations) {
      r = readVarintFromBuf(decompressed, readOffset);
      rotIdx = decodeZigzag(r.value); readOffset = r.offset;
    }

    const gx = lastX + bounds.minX;
    const gy = lastY + bounds.minY;
    const gz = lastZ + bounds.minZ;

    const ox = Math.floor(gx / CHUNK_SIZE) * CHUNK_SIZE;
    const oy = Math.floor(gy / CHUNK_SIZE) * CHUNK_SIZE;
    const oz = Math.floor(gz / CHUNK_SIZE) * CHUNK_SIZE;
    const chunkKey = `${ox},${oy},${oz}`;

    let chunk = chunksByKey.get(chunkKey);
    if (!chunk) {
      chunk = { ox, oy, oz, blocks: new Uint8Array(CHUNK_VOLUME), rots: new Map() };
      chunksByKey.set(chunkKey, chunk);
    }

    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((gz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const blockIndex = lx + (ly << CHUNK_SIZE_BITS) + (lz << (CHUNK_SIZE_BITS * 2));

    chunk.blocks[blockIndex] = blockTypeId;
    if (rotIdx !== 0) { chunk.rots.set(blockIndex, rotIdx); hasRotations = true; }
  }

  const rotationsEnabled = includeRotations && hasRotations;
  const metadata = {
    blockTypes: compressedMap.blockTypes ? (Array.isArray(compressedMap.blockTypes) ? compressedMap.blockTypes : Object.values(compressedMap.blockTypes)) : undefined,
    entities: compressedMap.entities,
    options: { rotations: rotationsEnabled },
    source: options.sourceSha256 ? { sha256: options.sourceSha256 } : undefined,
  };
  const metadataJson = Buffer.from(JSON.stringify(metadata), 'utf8');

  const chunks = Array.from(chunksByKey.values());
  chunks.sort((a, b) => a.oy - b.oy || a.ox - b.ox || a.oz - b.oz);

  // Calculate body size
  let bodySize = varintBufSize(metadataJson.byteLength) + metadataJson.byteLength + varintBufSize(chunks.length);
  for (const chunk of chunks) {
    bodySize += signedVarintBufSize(chunk.ox) + signedVarintBufSize(chunk.oy) + signedVarintBufSize(chunk.oz);
    bodySize += CHUNK_VOLUME;
    if (rotationsEnabled) {
      bodySize += varintBufSize(chunk.rots.size);
      for (const [bi] of chunk.rots) { bodySize += varintBufSize(bi) + 1; }
    }
  }

  const body = Buffer.allocUnsafe(bodySize);
  let woff = 0;
  woff = writeVarintToBuf(body, woff, metadataJson.byteLength);
  metadataJson.copy(body, woff); woff += metadataJson.byteLength;
  woff = writeVarintToBuf(body, woff, chunks.length);

  for (const chunk of chunks) {
    woff = writeSignedVarint(body, woff, chunk.ox);
    woff = writeSignedVarint(body, woff, chunk.oy);
    woff = writeSignedVarint(body, woff, chunk.oz);
    body.set(chunk.blocks, woff); woff += CHUNK_VOLUME;
    if (rotationsEnabled) {
      const rotEntries = Array.from(chunk.rots.entries()).sort((a, b) => a[0] - b[0]);
      woff = writeVarintToBuf(body, woff, rotEntries.length);
      for (const [bi, ri] of rotEntries) {
        woff = writeVarintToBuf(body, woff, bi);
        body.writeUInt8(ri, woff++);
      }
    }
  }

  // Header: 8 magic + 1 version + 1 algo + 2 reserved = 12 bytes
  const MAGIC = Buffer.from('HYTCHUNK');
  const ALGO_MAP = { 'none': 0, 'brotli': 1, 'gzip': 2 };
  const header = Buffer.allocUnsafe(12);
  MAGIC.copy(header, 0);
  header.writeUInt8(1, 8);
  header.writeUInt8(ALGO_MAP[options.algorithm] || 1, 9);
  header.writeUInt16LE(0, 10);

  const cacheAlgo = options.algorithm || 'brotli';
  const cacheLvl = options.level !== undefined ? options.level : 6;
  const bodyCompressed = compressBuffer(cacheAlgo, body, cacheLvl);

  return Buffer.concat([header, bodyCompressed]);
}

// -- Low-level encoding/decoding primitives --

function encodeZigzag(value) { return (value << 1) ^ (value >> 31); }
function decodeZigzag(value) { return (value >>> 1) ^ -(value & 1); }

function writeVarintToBuf(buffer, offset, value) {
  let current = value >>> 0;
  while (current > 0x7f) { buffer[offset++] = (current & 0x7f) | 0x80; current >>>= 7; }
  buffer[offset++] = current;
  return offset;
}

function writeSignedVarint(buffer, offset, signedValue) {
  return writeVarintToBuf(buffer, offset, encodeZigzag(signedValue));
}

function readVarintFromBuf(buffer, offset) {
  let value = 0, shift = 0, byte;
  do { byte = buffer[offset++]; value |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { value: value >>> 0, offset };
}

function varintBufSize(value) {
  let current = value >>> 0, size = 1;
  while (current > 0x7f) { size++; current >>>= 7; }
  return size;
}

function signedVarintBufSize(signedValue) {
  return varintBufSize(encodeZigzag(signedValue));
}

function compressBuffer(algorithm, input, level) {
  if (algorithm === 'none') return input;
  if (algorithm === 'gzip') return zlib.gzipSync(input, { level: Math.min(9, Math.max(0, level)) });
  return zlib.brotliCompressSync(input, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
      [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(0, level)),
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.byteLength,
    },
  });
}

function decompressBuffer(algorithm, input) {
  if (algorithm === 'none') return input;
  if (algorithm === 'gzip') return zlib.gunzipSync(input);
  return zlib.brotliDecompressSync(input);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

// ================================================================================
// UTILITY FUNCTIONS
// ================================================================================


async function build(devMode = false, inputFile = 'index.ts') {
  const outputFile = inputFile.replace(/\.ts$/, '.mjs');
  const envFlags = devMode ? '' : '--minify-whitespace --minify-syntax';

  execSync(`npx --yes bun build --target=node --env=disable --format=esm ${envFlags} --sourcemap=inline --external=@fails-components/webtransport --external=@fails-components/webtransport-transport-http3-quiche --outfile=${outputFile} ${inputFile}`, { stdio: 'inherit' });
}

/**
 * Parses command-line flags in the format --flag value
 */
function parseCommandLineFlags() {
  for (let i = 3; i < process.argv.length; i += 2) {
    if (i % 2 === 1) { // Odd indices are flags
      let flag = process.argv[i].replace('--', '');
      let value = process.argv[i + 1];

      if (flag.includes('=')) {
        [ flag, value ] = flag.split('=');
      }

      flags[flag] = value;
    }
  }
}

/**
 * Copies directory contents (cross-platform compatible)
 */
function copyDirectoryContents(srcDir, destDir, options = { recursive: true }) {
  if (!fs.existsSync(srcDir)) return false;
  
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const copyInto = (srcPath, destPath) => {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
        for (const entry of fs.readdirSync(srcPath)) {
          copyInto(path.join(srcPath, entry), path.join(destPath, entry));
        }
      } else {
        fs.cpSync(srcPath, destPath, { recursive: false, force: false });
      }
    };

    for (const item of fs.readdirSync(srcDir)) {
      copyInto(path.join(srcDir, item), path.join(destDir, item));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prints a divider line for better console output readability
 */
function logDivider() {
  console.log('--------------------------------');
}

/**
 * Displays available commands when an unknown command is entered
 */
function displayAvailableCommands(command) {
  console.log('Unknown command: ' + command);
  console.log('');
  displayHelp();
}

// ================================================================================
// VERSION CHECK AND UPGRADE
// ================================================================================

function getLocalVersion() {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version;
  } catch {
    return undefined;
  }
}

async function fetchLatestVersion(signal) {
  try {
    const res = await fetch('https://registry.npmjs.org/hytopia/latest', {
      headers: { 'Accept': 'application/vnd.npm.install-v1+json' },
      signal,
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.version;
  } catch {
    return undefined;
  }
}

function upgradeAssetsLibrary(versionArg = 'latest') {
  const version = versionArg.trim();
  console.log(`🔄 Upgrading @hytopia.com/assets package to: ${version} ...`);
  execSync(`npm install --save-optional --force @hytopia.com/assets@${version}`, { stdio: 'inherit' });
  console.log('✅ Upgrade complete.');
}

function upgradeCli(versionArg = 'latest') {
  const version = versionArg.trim();
  console.log(`🔄 Upgrading HYTOPIA CLI to: hytopia@${version} ...`);
  execSync(`npm install -g --force hytopia@${version}`, { stdio: 'inherit' });
  console.log('✅ Upgrade complete. You may need to restart your shell for changes to take effect.');
}

function upgradeProject(versionArg = 'latest') {
  const version = versionArg.trim();
  const spec = `hytopia@${version}`;
  console.log(`🔄 Upgrading project HYTOPIA SDK to: ${spec} ...`);
  execSync(`npm install --force ${spec}`, { stdio: 'inherit' });
  console.log('✅ Project dependency upgraded.');
}

// ==============================================================================
// HELP
// ==============================================================================

function displayHelp() {
  console.log('HYTOPIA CLI');
  console.log('');
  console.log('Usage:');
  console.log('  hytopia [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  help, -h, --help            Show this help');
  console.log('  version, -v, --version      Show CLI version');
  console.log('  build [FILE]                Build the project (Generates ESM .mjs from FILE, default: index.ts)');
  console.log('  build-dev [FILE]            Build in dev mode (Generates ESM .mjs from FILE, default: index.ts)');
  console.log('  start [FILE]                Start a HYTOPIA project server (Node.js & nodemon watch, default: index.ts)');
  console.log('  run [FILE]                  Run the project once without watching (default: index.ts)');
  console.log('  init [--template NAME]      Initialize a new project');
  console.log('  init-mcp                    Setup MCP integrations');
  console.log('  map-compress [FILE]         Compress a map for faster loading (default: assets/map.json)');
  console.log('  package                     Create a zip of the project for uploading to the HYTOPIA create portal.');
  console.log('  upgrade-assets-library [VERSION]    Upgrade the @hytopia.com/assets package (default: latest)');
  console.log('  upgrade-cli [VERSION]       Upgrade the HYTOPIA CLI (default: latest)');
  console.log('  upgrade-project [VERSION]   Upgrade project SDK dependency (default: latest)');
  console.log('');
  console.log('Examples:');
  console.log('  hytopia init --template zombies-fps');
  console.log('  hytopia start playground.ts');
  console.log('  hytopia map-compress');
  console.log('  hytopia map-compress assets/map.json --algorithm gzip');
  console.log('  hytopia upgrade-project 0.8.12');
}