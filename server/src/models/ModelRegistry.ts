import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execa }  from 'execa';
import { glob } from 'glob';
import { Logger, Verbosity, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRTextureBasisu } from '@gltf-transform/extensions';
import { center, clearNodeTransform, cloneDocument, dequantize, flatten, getBounds, join, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Jimp } from 'jimp';
import AssetsLibrary from '@/assets/AssetsLibrary';
import ErrorHandler from '@/errors/ErrorHandler';
import type { Document } from '@gltf-transform/core';
import type Vector3Like from '@/shared/types/math/Vector3Like';

/** @internal */
const MODEL_REGISTRY_CONFIG = {
  OPTIMIZED_DIR: '.optimized',
  TEMP_DIR: 'hytopia-models-temp',
  CHECKSUM_EXT: '.md5',
  VERSION: 4,
  DATA_EXT: '.data.json',
  DIRECTORIES: [ // order matters, last dir with the same model uri gets priority
    AssetsLibrary.assetsLibraryPath,
    path.resolve(process.cwd(), 'assets'),
  ].filter(Boolean) as string[],
  OPTIMIZER_RUNS: [
    {
      suffix: '', // default
      options: [
        '--compress', 'false',
        '--instance', 'false', 
        '--simplify', 'false',
        '--texture-compress', 'false', // Compress seperately with UASTC below
      ],
      stripAnimations: false,
      optimalMaxMeshCount: 10,
      optimalMaxMeshHint: 'Reduce nodes/meshes in your source model, or use fewer unique materials so primitives can be merged in the generated optimized model.',
      keepEmptyNamedNodes: false,
    },
    {
      suffix: '-named-nodes',
      options: [
        '--compress', 'false',
        '--flatten', 'false', // keepEmptyNamedNodes handles flattening.
        '--instance', 'false', 
        '--simplify', 'false',
        '--join', 'false',    // keepEmptyNamedNodes handles joining.
        '--prune', 'false',   // keepEmptyNamedNodes handles pruning.
        '--texture-compress', 'false', // Compress seperately with UASTC below
      ],
      stripAnimations: false,
      optimalMaxMeshCount: 20,
      optimalMaxMeshHint: 'Use fewer unique materials in your source model so primitives sharing the same material can be joined in the generated optimized model. Named nodes are preserved, reduce unnecessary named nodes to further reduce mesh count.',
      keepEmptyNamedNodes: true,
    },
    {
      suffix: '-no-animations',
      options: [
        '--compress', 'false',
        '--instance', 'false', 
        '--simplify', 'false',
        '--texture-compress', 'false', // Compress seperately with UASTC below
      ],
      stripAnimations: true,
      optimalMaxMeshCount: 1,
      optimalMaxMeshHint: 'Use a single material/texture atlas in your source model so all primitives can merge into one mesh in the generated optimized model.',
      keepEmptyNamedNodes: false,
    },
  ],
} as const;

/** @internal */
const MODEL_EXTENSIONS = [ KHRMaterialsEmissiveStrength, KHRTextureBasisu ];

/**
 * A bounding box for a model.
 *
 * **Category:** Models
 * @public
 */
export type ModelBoundingBox = {
  min: Vector3Like;
  max: Vector3Like;
};

/**
 * Data for a model.
 *
 * **Category:** Models
 * @public
 */
export type ModelData = { // If you modify the schema, you must increment the schemaVersion.
  schemaVersion: number,
  source: { uri: string, sha256: string },
  animationNames: string[],
  boundingBox: ModelBoundingBox,
  nodeNames: string[],
  trimesh?: { vertices: number[], indices: number[] },
  optimizedModelData?: { [key: string]: {
    meshCount: number
  } },
};

/**
 * A trimesh for a model.
 *
 * **Category:** Models
 * @public
 */
export type ModelTrimesh = {
  vertices: Float32Array;
  indices: Uint32Array;
};

/**
 * Manages model data for all known models of the game.
 *
 * When to use: querying model metadata (bounds, node names, animations, trimesh).
 * Do NOT use for: runtime mesh editing; use dedicated tooling or physics colliders.
 *
 * @remarks
 * The ModelRegistry is created internally as a global
 * singleton accessible via `ModelRegistry.instance`.
 * Model data is preloaded during server startup and cached in memory.
 *
 * Pattern: call `ModelRegistry.hasModel` before accessing metadata to avoid warnings.
 * Anti-pattern: calling `ModelRegistry.getTrimesh` every tick; it may allocate arrays.
 *
 * @example
 * ```typescript
 * import { ModelRegistry } from 'hytopia';
 * 
 * const modelRegistry = ModelRegistry.instance;
 * const boundingBox = modelRegistry.getBoundingBox('models/player.gltf');
 * ```
 *
 * **Category:** Models
 * @public
 */
export default class ModelRegistry {
  /**
   * The global ModelRegistry instance as a singleton.
   *
   * **Category:** Models
   */
  public static readonly instance: ModelRegistry = new ModelRegistry();

  /**
   * Whether to generate optimized models if needed.
   *
   * Defaults to `true` in development, `false` in production.
   *
   * **Category:** Models
   */
  public optimize: boolean = process.env.NODE_ENV !== 'production';

  /** @internal */
  private _modelUriAnimationNames: Map<string, string[]> = new Map();

  /** @internal */
  private _modelUriBoundingBoxes: Map<string, ModelBoundingBox> = new Map();

  /** @internal */
  private _modelUriNodeNames: Map<string, string[]> = new Map();

  /** @internal */
  private _modelUriTrimeshes: Map<string, ModelTrimesh | undefined> = new Map();

  /** @internal */
  private constructor() { }

  /** @internal */
  public async preloadModels(): Promise<void> {
    const absoluteModelPaths = await this._getAbsoluteModelPaths();

    console.info(`ModelRegistry.preloadModels(): Preloading ${absoluteModelPaths.length} models...`);

    const start = performance.now();
    for (const absoluteModelPath of absoluteModelPaths) {
      if (this.optimize) {
        await this._resolveOptimizedModelPath(absoluteModelPath);
      }

      await this._loadModelData(absoluteModelPath);
    }
    const end = performance.now();
    console.info(`ModelRegistry.preloadModels(): Preloaded ${absoluteModelPaths.length} models in ${end - start}ms!`);
  }

  /**
   * Retrieves an array of all available model URIs.
   *
   * @returns An array of all available model URIs.
   *
   * **Category:** Models
   */
  public getAllModelUris(): string[] {
    return Array.from(this._modelUriBoundingBoxes.keys());
  }

  /**
   * Retrieves an array of all known animation names for a model.
   *
   * @param modelUri - The URI of the model to retrieve the animation names for.
   * @returns An array of all known animation names for the model.
   *
   * **Requires:** Model data must be loaded (server startup).
   *
   * **Category:** Models
   */
  public getAnimationNames(modelUri: string): Readonly<string[]> {
    const animationNames = this._modelUriAnimationNames.get(modelUri);

    if (!animationNames) {
      ErrorHandler.error(`ModelRegistry.getAnimationNames(): Model ${modelUri} not found!`);

      return [];
    }

    return animationNames;
  }

  /**
   * Retrieves the bounding box of a model.
   *
   * @param modelUri - The URI of the model to retrieve the bounding box for.
   * @returns The bounding box of the model.
   *
   * **Requires:** Model data must be loaded (server startup).
   *
   * **Category:** Models
   */
  public getBoundingBox(modelUri: string): ModelBoundingBox {
    const boundingBox = this._modelUriBoundingBoxes.get(modelUri);

    if (!boundingBox) {
      ErrorHandler.error(`ModelRegistry.getBoundingBox(): Model ${modelUri} not found!`);

      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      };
    }

    return boundingBox;
  }

  /**
   * Retrieves the Z-axis depth of a model for a scale of 1.
   *
   * @param modelUri - The URI of the model to retrieve the depth for.
   * @returns The depth of the model.
   *
   * @see `ModelRegistry.getBoundingBox`
   *
   * **Category:** Models
   */
  public getDepth(modelUri: string): number {
    const boundingBox = this.getBoundingBox(modelUri);
    
    return boundingBox.max.z - boundingBox.min.z;
  }

  /**
   * Retrieves the Y-axis height of a model for a scale of 1.
   *
   * @param modelUri - The URI of the model to retrieve the height for.
   * @returns The height of the model.
   *
   * @see `ModelRegistry.getBoundingBox`
   *
   * **Category:** Models
   */
  public getHeight(modelUri: string) {
    const boundingBox = this.getBoundingBox(modelUri);
   
    return boundingBox.max.y - boundingBox.min.y;
  }

  /**
   * Retrieves the names of all nodes in a model.
   *
   * @param modelUri - The URI of the model to retrieve the node names for.
   * @returns The names of all nodes in the model.
   *
   * **Requires:** Model data must be loaded (server startup).
   *
   * **Category:** Models
   */
  public getNodeNames(modelUri: string): string[] {
    const nodeNames = this._modelUriNodeNames.get(modelUri);

    if (!nodeNames) {
      ErrorHandler.error(`ModelRegistry.getNodeNames(): Model ${modelUri} not found!`);

      return [];
    }

    return nodeNames;
  }

  /**
   * Retrieves the trimesh of a model.
   *
   * @param modelUri - The URI of the model to retrieve the trimesh for.
   * @param scale - Optional scaling to apply to the trimesh. Defaults to 1 for all axes (no scaling).
   * @returns The trimesh of the model.
   *
   * **Requires:** Model data must be loaded (server startup).
   *
   * **Category:** Models
   */
  public getTrimesh(modelUri: string, scale: Vector3Like = { x: 1, y: 1, z: 1 }): ModelTrimesh | undefined {
    const trimesh = this._modelUriTrimeshes.get(modelUri);

    if (!trimesh) {
      ErrorHandler.error(`ModelRegistry.getTrimesh(): Model ${modelUri} not found!`);
      
      return undefined;
    }

    let vertices = trimesh.vertices;

    // Apply per-axis scaling if needed
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
      vertices = new Float32Array(vertices.length);

      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i]     = trimesh.vertices[i]     * scale.x;  // x
        vertices[i + 1] = trimesh.vertices[i + 1] * scale.y;  // y
        vertices[i + 2] = trimesh.vertices[i + 2] * scale.z;  // z
      }
    }

    return { vertices, indices: trimesh.indices };
  }

  /**
   * Retrieves the X-axis width of a model for a scale of 1.
   *
   * @param modelUri - The URI of the model to retrieve the width for.
   * @returns The width of the model.
   *
   * @see `ModelRegistry.getBoundingBox`
   *
   * **Category:** Models
   */
  public getWidth(modelUri: string): number {
    const boundingBox = this.getBoundingBox(modelUri);

    return boundingBox.max.x - boundingBox.min.x;
  }

  /**
   * Checks if a model is registered in the model registry.
   *
   * @param modelUri - The URI of the model to check.
   * @returns Whether the model is registered.
   *
   * **Category:** Models
   */
  public hasModel(modelUri: string): boolean {
    return this._modelUriBoundingBoxes.has(modelUri);
  }
  
  /**
   * Checks if a model has a node with the given name.
   *
   * @param modelUri - The URI of the model to check.
   * @param nodeName - The name of the node to check for.
   * @returns Whether the model has a node with the given name.
   *
   * **Requires:** Model data must be loaded (server startup).
   *
   * **Category:** Models
   */
  public modelHasNode(modelUri: string, nodeName: string): boolean {
    const nodeNames = this._modelUriNodeNames.get(modelUri);

    if (!nodeNames) {
      ErrorHandler.error(`ModelRegistry.modelHasNode(): Model ${modelUri} not found!`);

      return false;
    }

    return nodeNames.includes(nodeName);
  }

  /** @internal */
  private _absoluteModelPathToModelUri(absoluteModelPath: string): string {
    const normalizedPath = path.normalize(absoluteModelPath);
    
    for (const dir of MODEL_REGISTRY_CONFIG.DIRECTORIES) {
      const normalizedDir = path.normalize(dir);
      
      if (normalizedPath.startsWith(normalizedDir)) {
        const relativePath = path.relative(normalizedDir, normalizedPath);

        return relativePath.replace(/\\/g, '/');
      }
    }

    return path.basename(normalizedPath);
  }

  /** @internal */
  private async _getAbsoluteModelPaths(): Promise<string[]> {
    const modelPaths: string[] = [];

    for (const dir of MODEL_REGISTRY_CONFIG.DIRECTORIES) {
      const dirPath = path.resolve(process.cwd(), dir);
      
      if (!fs.existsSync(dirPath)) continue;

      const files = await glob('**/*.{gltf,glb}', { cwd: dirPath, follow: true });
      for (const file of files) {
        modelPaths.push(path.join(dirPath, file));
      }
    }

    return modelPaths;
  }

  /** @internal */
  private async _loadModelData(absoluteModelPath: string): Promise<void> {
    const optimizedPath = this._buildOptimizedModelPath(absoluteModelPath);
    const dataPath = `${optimizedPath}${MODEL_REGISTRY_CONFIG.DATA_EXT}`;
    const modelUri = this._absoluteModelPathToModelUri(absoluteModelPath);
    const currentChecksum = this._calculateChecksum(absoluteModelPath);
    const isAssetLibraryModel = AssetsLibrary.assetsLibraryPath && absoluteModelPath.startsWith(AssetsLibrary.assetsLibraryPath);

    let data: ModelData | undefined;

    // Load existing data
    if (fs.existsSync(dataPath)) {
      try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        const parsed = JSON.parse(raw) as ModelData;

        if (parsed?.schemaVersion !== MODEL_REGISTRY_CONFIG.VERSION) {
          throw new Error('ModelRegistry._loadModelData(): Schema version mismatch! Data will be regenerated..');
        }

        if (parsed?.source?.sha256 !== currentChecksum) {
          throw new Error('ModelRegistry._loadModelData(): Checksum mismatch! Data will be regenerated..');
        }

        data = parsed;
      } catch { /* Fall through to regenerate */ }
    }

    // If no existing data, or it's outdated or invalid, create and write new data.
    if (!data) {
      const document = await new NodeIO().registerExtensions(MODEL_EXTENSIONS).read(absoluteModelPath);
      const boundingBox = getBounds(document.getRoot().listScenes()[0]);
      const nodeNames = document.getRoot().listNodes().map(node => node.getName());
      const animationNames = document.getRoot().listAnimations().map(animation => animation.getName());
      const trimesh = await this._buildTrimesh(document);
      const optimizedModelData: { [key: string]: { meshCount: number } } = {};
      const io = new NodeIO().registerExtensions(MODEL_EXTENSIONS);
      const meshCountFallback = document.getRoot().listMeshes().length;
      
      for (const run of MODEL_REGISTRY_CONFIG.OPTIMIZER_RUNS) {
        const optimizedModelPath = this._buildOptimizedModelPath(absoluteModelPath);
        const optimizedSuffixedModelPath = this._resolveExistingOptimizedSuffixedModelPath(optimizedModelPath, run.suffix);
        let meshCount = meshCountFallback;

        if (optimizedSuffixedModelPath) {
          try {
            meshCount = (await io.read(optimizedSuffixedModelPath)).getRoot().listMeshes().length;
          } catch {
            meshCount = meshCountFallback;
          }
        }

        optimizedModelData[run.suffix] = {
          meshCount,
        };
      }

      data = {
        schemaVersion: MODEL_REGISTRY_CONFIG.VERSION,
        source: { uri: modelUri, sha256: currentChecksum },
        animationNames,
        boundingBox: {
          min: { x: boundingBox.min[0], y: boundingBox.min[1], z: boundingBox.min[2] },
          max: { x: boundingBox.max[0], y: boundingBox.max[1], z: boundingBox.max[2] },
        },
        nodeNames,
        trimesh: trimesh ? {
          vertices: Array.from(trimesh.vertices),
          indices: Array.from(trimesh.indices),
        } : undefined,
        optimizedModelData,
      };

      try {
        const dir = path.dirname(dataPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dataPath, JSON.stringify(data));
      } catch (e) {
        ErrorHandler.warning(`ModelRegistry._loadModelData(): Failed to write data file for ${modelUri}. Error: ${String(e)}`);
      }
    }

    // Check for optimization warnings, only in project models
    if (process.env.NODE_ENV !== 'production' && !isAssetLibraryModel) {
      for (const run of MODEL_REGISTRY_CONFIG.OPTIMIZER_RUNS) {
        const meshCount = data.optimizedModelData![run.suffix].meshCount;
        if (meshCount > run.optimalMaxMeshCount) {
          ErrorHandler.warning(
            `Model "${modelUri}" (${run.suffix}) has ${meshCount} meshes (less is better, try not to exceed: ${run.optimalMaxMeshCount}). ` +
            `This may impact FPS if this model is used in a game. ${run.optimalMaxMeshHint}`,
          );
        }
      }
    }

    // Set data in memory
    this._modelUriAnimationNames.set(modelUri, data.animationNames);
    this._modelUriBoundingBoxes.set(modelUri, data.boundingBox);
    this._modelUriNodeNames.set(modelUri, data.nodeNames);
    this._modelUriTrimeshes.set(modelUri, data.trimesh ? {
      vertices: new Float32Array(data.trimesh.vertices),
      indices: new Uint32Array(data.trimesh.indices),
    } : undefined);
  }

  /** @internal */
  private async _resolveOptimizedModelPath(modelPath: string): Promise<string> {
    const optimizedPath = this._buildOptimizedModelPath(modelPath);
    
    if (this._isOptimizedVersionValid(modelPath)) {
      return optimizedPath;
    }

    return await this._optimizeModel(modelPath, optimizedPath);
  }

  /** @internal */
  private _isOptimizedVersionValid(modelPath: string): boolean {
    const checksumPath = `${this._buildOptimizedModelPath(modelPath)}${MODEL_REGISTRY_CONFIG.CHECKSUM_EXT}`;

    if (!fs.existsSync(checksumPath)) return false;

    const currentChecksum = this._calculateChecksum(modelPath);
    const savedChecksum = fs.readFileSync(checksumPath, 'utf8');
    
    return currentChecksum === savedChecksum;
  }

  /** @internal */
  private _calculateChecksum(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    
    const fileContent = fs.readFileSync(filePath);

    return crypto.createHash('sha256')
      .update(fileContent.toString('base64'))
      .update(MODEL_REGISTRY_CONFIG.VERSION.toString())
      .digest('hex');
  }
  
  /** @internal */
  private _buildOptimizedModelPath(modelPath: string): string {
    const filename = path.basename(modelPath);
    const filenameNoExt = filename.replace(/\.[^/.]+$/, '');
    const modelDir = path.dirname(modelPath);
    const optimizedDir = path.join(modelDir, MODEL_REGISTRY_CONFIG.OPTIMIZED_DIR, filenameNoExt);
    
    return path.join(optimizedDir, filename);
  }

  /** @internal */
  private _buildOptimizedSuffixedModelPath(optimizedModelPath: string, suffix: string): string {
    return optimizedModelPath.replace(/(\.[^/.]+)$/, `${suffix}.glb`);
  }

  /** @internal */
  private _resolveExistingOptimizedSuffixedModelPath(optimizedModelPath: string, suffix: string): string | undefined {
    const glbPath = this._buildOptimizedSuffixedModelPath(optimizedModelPath, suffix);
    const optimizedExt = path.extname(optimizedModelPath) || '.gltf';

    const candidates = [
      glbPath,
      glbPath.replace(/\.glb$/i, optimizedExt),
      glbPath.replace(/\.glb$/i, '.gltf'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return undefined;
  }

  /** @internal */
  private async _buildTrimesh(document: Document, ratio: number = 1, error: number = 0.001): Promise<ModelTrimesh | undefined> {
    const clonedDocument = cloneDocument(document);
    clonedDocument.setLogger(new Logger(Verbosity.WARN));

    await clonedDocument.transform(
      center({ pivot: 'center' }),
      flatten(),
      join(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio, error }),
      dequantize(),
    );

    // Clear all immediate root->child node transforms, otherwise
    // the trimesh will be incorrectly transformed.
    for (const scene of clonedDocument.getRoot().listScenes()) {
      for (const node of scene.listChildren()) {
        clearNodeTransform(node);
      }
    }

    // Convert meshes into trimeshes.
    const trimeshes: { vertices: Float32Array, indices: Uint32Array }[] = [];
    let totalVertexFloatCount = 0; // number of float components (x,y,z per vertex)
    let totalIndexCount = 0;

    for (const mesh of clonedDocument.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const positionAttribute = primitive.getAttribute('POSITION');
        const indicesAccessor = primitive.getIndices();

        if (!positionAttribute || !indicesAccessor) {
          continue;
        }

        const vertexArray = positionAttribute.getArray() as Float32Array;
        const rawIndexArray = indicesAccessor.getArray() as Uint32Array | Uint16Array | Uint8Array;
        const indexArray = rawIndexArray instanceof Uint32Array ? rawIndexArray : new Uint32Array(rawIndexArray);

        if (vertexArray.length === 0 || indexArray.length === 0) {
          continue;
        }

        trimeshes.push({ vertices: vertexArray, indices: indexArray });
        totalVertexFloatCount += vertexArray.length;
        totalIndexCount += indexArray.length;
      }
    }

    if (trimeshes.length === 0) {
      ErrorHandler.error('ModelRegistry._buildTrimesh(): Model has no primitives with POSITION and INDICES!');
      
      return undefined;
    }

    // Merge trimeshes into a single trimesh.
    const mergedVertices = new Float32Array(totalVertexFloatCount);
    const mergedIndices = new Uint32Array(totalIndexCount);

    let vertexFloatOffset = 0; // offset into mergedVertices in floats
    let vertexOffset = 0;      // offset into vertices in vertex count (triplets)
    let indexOffset = 0;       // offset into mergedIndices

    for (const trimesh of trimeshes) {
      mergedVertices.set(trimesh.vertices, vertexFloatOffset);

      const trimeshVertexCount = trimesh.vertices.length / 3; // 3 floats per vertex
      for (let i = 0; i < trimesh.indices.length; i++) {
        mergedIndices[indexOffset + i] = trimesh.indices[i] + vertexOffset;
      }

      vertexFloatOffset += trimesh.vertices.length;
      indexOffset += trimesh.indices.length;
      vertexOffset += trimeshVertexCount;
    }

    return {
      vertices: mergedVertices,
      indices: mergedIndices,
    };
  }

  /** @internal */
  private async _optimizeModel(inputPath: string, outputPath: string): Promise<string> {
    const outputDir = path.dirname(outputPath);

    // Clean and recreate output directory
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Create optimized models
    console.info(`ModelRegistry: Optimizing model ${this._absoluteModelPathToModelUri(inputPath)}...`);
    
    for (const run of MODEL_REGISTRY_CONFIG.OPTIMIZER_RUNS) {
      const runOutputPath = this._buildOptimizedSuffixedModelPath(outputPath, run.suffix);

      // Preprocess the model for the run, if necessary.
      const preprocessedInputPath = await this._preprocessOptimizableModel(inputPath, run);

      // Optimize the model!
      const optimizeResult = await execa('npx', [
        '@gltf-transform/cli', 'optimize',
        preprocessedInputPath, runOutputPath,
        ...run.options,
      ]);

      if (optimizeResult.stderr) {
        ErrorHandler.warning(`ModelRegistry._optimizeModel(): Error optimizing model ${this._absoluteModelPathToModelUri(inputPath)}, defaulting to unoptimized model. Error: ${optimizeResult.stderr}`);
  
        return inputPath;
      }

      // Embed relevant metadata after base optimization
      await this._embedModelMetadata(runOutputPath);

      // Use KTX2+UASTC textures
      const uastcResult = await execa('npx', [
        '@gltf-transform/cli', 'uastc',
        runOutputPath, runOutputPath,
        '--level', '4',        // Lossless textures
        '--zstd', '10',        // Modest supercompression (2MB RAM to decompress - low-end device friendly)
      ]);

      if (uastcResult.stderr) {
        ErrorHandler.warning(`ModelRegistry._optimizeModel(): Error compressing textures for model ${this._absoluteModelPathToModelUri(inputPath)}, continuing without compression. Error: ${uastcResult.stderr}`);
      }
    }

    // Save checksum for future validation
    fs.writeFileSync(
      `${outputPath}${MODEL_REGISTRY_CONFIG.CHECKSUM_EXT}`,
      this._calculateChecksum(inputPath),
    );

    return outputPath;
  }

  /** @internal */
  private async _embedModelMetadata(modelPath: string): Promise<void> {
    try {
      const io = new NodeIO().registerExtensions(MODEL_EXTENSIONS);
      const document = await io.read(modelPath);
      
      for (const material of document.getRoot().listMaterials()) {
        const texture = material.getBaseColorTexture();
        const image = texture?.getImage();
        let hasTransparency = false;
        
        // The glTF spec forbids combining MASK mode (alphaTest) with BLEND mode (transparent), but
        // tools like BlockBench export assets expecting both. We scan texture alpha channels for
        // semi-transparent pixels (alphaTest to 254) and store the result in material.extras.hasTransparency.
        // Pixels with alpha in range [alphaThreshold, 255) need transparency rendering by client.
        if (image) {
          try {
            const alphaTest = material.getAlphaMode() === 'MASK' ? (material.getAlphaCutoff() ?? 0.5) : 0.0;
            const opacity = material.getAlpha();
            const alphaThreshold = (alphaTest / opacity) * 255;
            const { data } = (await Jimp.read(Buffer.from(image))).bitmap;
            
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] >= alphaThreshold && data[i] < 255) {
                hasTransparency = true;
                break;
              }
            }
          } catch { /* ignore errors */ }
        }
        
        material.setExtras({ ...material.getExtras(), hasTransparency });
      }

      await io.write(modelPath, document);
    } catch (error) {
      ErrorHandler.warning(`ModelRegistry._embedModelMetadata(): Failed to embed metadata for ${modelPath}. Error: ${String(error)}`);
    }
  }
  
  /** @internal */
  private async _preprocessOptimizableModel(inputPath: string, run: typeof MODEL_REGISTRY_CONFIG.OPTIMIZER_RUNS[number]): Promise<string> {
    const io = new NodeIO().registerExtensions(MODEL_EXTENSIONS);
    const document = await io.read(inputPath);

    let requiresTempPath = false;

    // Strip animations if necessary.
    if (run.stripAnimations) {
      const animations = document.getRoot().listAnimations();
      
      if (animations.length > 0) {
        animations.forEach(animation => animation.dispose());
        requiresTempPath = true;
      }
    }

    // Preserve empty/anchor nodes/leaves.
    if (run.keepEmptyNamedNodes) {
      await document.transform(
        flatten({ cleanup: false }),
        join({ cleanup: false, keepNamed: true }),
        prune({ keepLeaves: true }),
      );
      requiresTempPath = true;
    }

    // If we did any kind of preprocessing, write the model to a temporary path for use by the optimizer.
    if (requiresTempPath) {
      const tempDir = path.join(os.tmpdir(), MODEL_REGISTRY_CONFIG.TEMP_DIR);
      fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, path.basename(inputPath));
      await io.write(tempPath, document);

      return tempPath;
    }

    return inputPath;
  }
}
