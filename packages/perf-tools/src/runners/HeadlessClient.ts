import type { ClientSnapshot } from './MetricCollector.js';

declare global {
  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

export interface HeadlessClientOptions {
  url: string;
  headless?: boolean;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  collectPerformance?: boolean;
}

export default class HeadlessClient {
  private _browser: unknown = null;
  private _page: unknown = null;
  private _cdp: any = null;
  private _options: HeadlessClientOptions;
  private _performanceEntries: ClientSnapshot[] = [];
  private _connected: boolean = false;

  constructor(options: HeadlessClientOptions) {
    this._options = {
      headless: true,
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      collectPerformance: true,
      ...options,
    };
  }

  public async launch(): Promise<void> {
    let puppeteer: any;

    try {
      puppeteer = await import('puppeteer');
    } catch {
      throw new Error(
        'puppeteer is required for headless client. Install it: npm install puppeteer',
      );
    }

    this._browser = await puppeteer.default.launch({
      headless: this._options.headless ? 'new' : false,
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
        '--disable-web-security',
        '--disable-features=PrivateNetworkAccessSendPreflights',
        '--enable-precise-memory-info',
        '--disable-notifications',
        '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-swiftshader',
        `--window-size=${this._options.width},${this._options.height}`,
      ],
    });

    const browser = this._browser as any;

    this._page = await browser.newPage();

    const page = this._page as any;

    await page.setViewport({
      width: this._options.width!,
      height: this._options.height!,
      deviceScaleFactor: this._options.deviceScaleFactor,
    });

    // Forward browser console to Node stdout for debugging
    page.on('console', (msg: any) => {
      const type = msg.type();
      const text = msg.text();

      if (type === 'error' || type === 'warning') {
        console.log(`[client:${type}] ${text}`);
      }
    });

    page.on('pageerror', (err: any) => {
      console.log(`[client:error] ${err.message ?? err}`);
    });

    this._cdp = await page.createCDPSession();

    // Bypass certificate errors via CDP (--ignore-certificate-errors doesn't work in headless: 'new')
    await this._cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });

    if (this._options.collectPerformance) {
      await this._cdp.send('Performance.enable');
    }

    // Patch fetch() to strip unsupported targetAddressSpace option
    // (Chrome's Private Network Access API is not available in all Chrome versions)
    await page.evaluateOnNewDocument(() => {
      const originalFetch = window.fetch.bind(window);

      (window as any).fetch = function(input: any, init?: any) {
        if (init && 'targetAddressSpace' in init) {
          const { targetAddressSpace: _, ...rest } = init;

          return originalFetch(input, rest);
        }

        return originalFetch(input, init);
      };

    });

    await page.evaluateOnNewDocument(() => {
      if ((window as any).__HYTOPIA_FALLBACK_PERF__) {
        return;
      }

      const state = {
        fps: 0,
        frameTimeMs: 0,
        lastFrameTimestamp: 0,
        fpsWindowStart: 0,
        fpsWindowFrames: 0,
        drawCallsThisFrame: 0,
        trianglesThisFrame: 0,
        drawCallsLastFrame: 0,
        trianglesLastFrame: 0,
        usedMemoryMb: 0,
        totalMemoryMb: 0,
        hasSeenDrawCall: false,
      };

      const getTrianglesPerCall = (mode: number, count: number): number => {
        switch (mode) {
          case WebGLRenderingContext.TRIANGLES:
            return Math.floor(count / 3);
          case WebGLRenderingContext.TRIANGLE_STRIP:
          case WebGLRenderingContext.TRIANGLE_FAN:
            return Math.max(0, count - 2);
          default:
            return 0;
        }
      };

      const wrapDraw = (proto: any, methodName: string, getCount: (...args: any[]) => number, getInstances?: (...args: any[]) => number) => {
        if (!proto?.[methodName] || proto[methodName].__hytopiaPerfWrapped) {
          return;
        }

        const original = proto[methodName];

        const wrapped = function(this: unknown, ...args: any[]) {
          const count = getCount(...args);
          const instances = getInstances ? Math.max(1, getInstances(...args)) : 1;

          state.drawCallsThisFrame += 1;
          state.trianglesThisFrame += getTrianglesPerCall(args[0], count) * instances;
          state.hasSeenDrawCall = true;

          return original.apply(this, args);
        };

        wrapped.__hytopiaPerfWrapped = true;
        proto[methodName] = wrapped;
      };

      const webgl1Prototype = typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : undefined;
      const webgl2Prototype = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : undefined;

      wrapDraw(webgl1Prototype, 'drawArrays', (_mode: number, _first: number, count: number) => count);
      wrapDraw(webgl1Prototype, 'drawElements', (_mode: number, count: number) => count);
      wrapDraw(webgl2Prototype, 'drawArrays', (_mode: number, _first: number, count: number) => count);
      wrapDraw(webgl2Prototype, 'drawElements', (_mode: number, count: number) => count);
      wrapDraw(webgl2Prototype, 'drawArraysInstanced', (_mode: number, _first: number, count: number) => count, (_mode: number, _first: number, _count: number, instanceCount: number) => instanceCount);
      wrapDraw(webgl2Prototype, 'drawElementsInstanced', (_mode: number, count: number) => count, (_mode: number, _count: number, _type: number, _offset: number, instanceCount: number) => instanceCount);

      const tick = (timestamp: number) => {
        if (state.lastFrameTimestamp > 0) {
          state.frameTimeMs = timestamp - state.lastFrameTimestamp;
        }

        if (state.fpsWindowStart === 0) {
          state.fpsWindowStart = timestamp;
        }

        state.fpsWindowFrames += 1;

        if (timestamp - state.fpsWindowStart >= 1000) {
          state.fps = (state.fpsWindowFrames * 1000) / (timestamp - state.fpsWindowStart);
          state.fpsWindowFrames = 0;
          state.fpsWindowStart = timestamp;
        }

        state.lastFrameTimestamp = timestamp;
        state.drawCallsLastFrame = state.drawCallsThisFrame;
        state.trianglesLastFrame = state.trianglesThisFrame;
        state.drawCallsThisFrame = 0;
        state.trianglesThisFrame = 0;

        const memory = performance.memory;

        if (memory) {
          state.usedMemoryMb = memory.usedJSHeapSize / (1024 * 1024);
          state.totalMemoryMb = memory.totalJSHeapSize / (1024 * 1024);
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);

      (window as any).__HYTOPIA_FALLBACK_PERF__ = {
        isReady() {
          return state.hasSeenDrawCall;
        },
        snapshot() {
          return {
            source: 'webgl_fallback',
            fps: state.fps,
            frameTimeMs: state.frameTimeMs,
            drawCalls: state.drawCallsLastFrame,
            triangles: state.trianglesLastFrame,
            textureMemoryMb: 0,
            usedMemoryMb: state.usedMemoryMb,
            totalMemoryMb: state.totalMemoryMb,
          };
        },
      };
    });
  }

  /**
   * Visit the game server URL once to warm up the self-signed HTTPS cert
   * in Chrome's cert cache. Without this, in-page fetch() to the server fails.
   */
  public async warmCert(serverUrl: string): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    try {
      await page.goto(serverUrl, { waitUntil: 'load', timeout: 15000 });
    } catch {
      // Expected — self-signed cert page may fail but Chrome records the exception
    }
  }

  public async navigate(url?: string): Promise<void> {
    const page = this._page as any;

    if (!page) throw new Error('Client not launched. Call launch() first.');

    const target = new URL(url ?? this._options.url);

    target.searchParams.set('perf', '1');

    await page.goto(target.toString(), { waitUntil: 'load', timeout: 60000 });
    this._connected = true;
  }

  public async waitForPerfReady(timeoutMs: number = 30000): Promise<boolean> {
    const page = this._page as any;

    if (!page) return false;

    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await page.evaluate(() => {
          const perf = (window as any).__HYTOPIA_PERF__;
          const fallbackPerf = (window as any).__HYTOPIA_FALLBACK_PERF__;

          if (perf && typeof perf.snapshot === 'function') {
            return true;
          }

          if (fallbackPerf && typeof fallbackPerf.isReady === 'function') {
            return fallbackPerf.isReady();
          }

          return false;
        });

        if (ready) return true;
      } catch {
        // page not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return false;
  }

  public async dismissModals(): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    try {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('.hytopia-modal-button-ok');

        buttons.forEach((btn: any) => btn.click());
      });
    } catch {
      // no modals present
    }
  }

  public async collectClientMetrics(): Promise<ClientSnapshot | null> {
    const page = this._page as any;

    if (!page || !this._connected) return null;

    try {
      // Dismiss any modals that might have appeared
      await this.dismissModals();

      const metrics = await page.evaluate(() => {
        const perf = (window as any).__HYTOPIA_PERF__;
        const fallbackPerf = (window as any).__HYTOPIA_FALLBACK_PERF__;

        return {
          perfSnapshot: perf && typeof perf.snapshot === 'function' ? perf.snapshot() : null,
          fallbackSnapshot: fallbackPerf && typeof fallbackPerf.snapshot === 'function' && fallbackPerf.isReady()
            ? fallbackPerf.snapshot()
            : null,
        };
      });

      const normalized = normalizeClientMetrics(metrics?.perfSnapshot, metrics?.fallbackSnapshot);

      if (!normalized) return null;

      const snapshot: ClientSnapshot = {
        timestamp: Date.now(),
        ...normalized,
      };

      this._performanceEntries.push(snapshot);

      return snapshot;
    } catch {
      return null;
    }
  }

  /**
   * Send movement input directly via the game's network manager.
   * Bypasses pointer lock / keyboard events — works in headless mode.
   * Sends packets continuously at 30Hz to match InputManager behavior.
   * key: 'w' | 'a' | 's' | 'd' | 'sp' (space/jump)
   */
  public async sendMovement(key: string, durationMs: number): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    try {
      // Send start packet and then continue sending at 30Hz with camera orientation
      await page.evaluate((k: string, durMs: number) => {
        const game = (window as any).__HYTOPIA_GAME__;

        if (!game?.networkManager) return;

        // Send initial key-down
        game.networkManager.sendInputPacket({ [k]: true });

        // Send continuous camera+movement at 30Hz so server knows direction
        const interval = setInterval(() => {
          const yaw = game.camera?._gameCameraYaw ?? 0;
          const pitch = game.camera?._gameCameraPitch ?? 0;

          game.networkManager.sendInputPacket({ cp: pitch, cy: yaw });
        }, 33);

        // Store cleanup for later
        (window as any).__HYTOPIA_MOVEMENT_INTERVAL__ = interval;
        (window as any).__HYTOPIA_MOVEMENT_KEY__ = k;

        // Auto-stop after duration
        setTimeout(() => {
          clearInterval(interval);
          game.networkManager.sendInputPacket({ [k]: false });
          (window as any).__HYTOPIA_MOVEMENT_INTERVAL__ = null;
        }, durMs);
      }, key, durationMs);

      // Wait for the movement to complete
      await new Promise(r => setTimeout(r, durationMs + 100));
    } catch {
      // best-effort
    }
  }

  /**
   * Simulate mouse look by injecting camera yaw/pitch directly via the game's input system.
   */
  public async lookAt(yawRadians: number, pitchRadians: number): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    try {
      await page.evaluate((yaw: number, pitch: number) => {
        const game = (window as any).__HYTOPIA_GAME__;

        if (!game) return;

        // Set camera yaw/pitch directly on the Camera object (client-side rendering)
        if (game.camera) {
          game.camera._gameCameraYaw = yaw;
          game.camera._gameCameraPitch = pitch;
        }

        // Also send to server so movement direction matches camera direction
        if (game.networkManager) {
          game.networkManager.sendInputPacket({ cp: pitch, cy: yaw });
        }
      }, yawRadians, pitchRadians);
    } catch {
      // best-effort
    }
  }

  /**
   * Teleport the camera/player to a specific world position.
   * Works by directly setting the camera target position.
   */
  public async setCameraPosition(x: number, y: number, z: number): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    try {
      await page.evaluate((px: number, py: number, pz: number) => {
        const game = (window as any).__HYTOPIA_GAME__;

        if (game?.camera) {
          game.camera.setTarget(px, py, pz);
        }
      }, x, y, z);
    } catch {
      // best-effort
    }
  }

  /**
   * Simulate a player walking forward for a duration, with optional camera rotation.
   * This makes the headless client behave like a real player walking around.
   */
  public async simulateWalkSequence(steps: Array<{ durationMs: number; key?: string; yaw?: number; pitch?: number }>): Promise<void> {
    const page = this._page as any;

    if (!page) return;

    // Click to get pointer lock
    try {
      await page.mouse.click(640, 360);
      await new Promise(r => setTimeout(r, 300));
    } catch {
      // continue
    }

    for (const step of steps) {
      try {
        // Set camera direction if specified
        if (step.yaw !== undefined || step.pitch !== undefined) {
          await this.lookAt(step.yaw ?? 0, step.pitch ?? -0.3);
        }

        // Press movement key
        const key = step.key ?? 'w';

        await page.keyboard.down(key);
        await new Promise(r => setTimeout(r, step.durationMs));
        await page.keyboard.up(key);
      } catch {
        // continue sequence
      }
    }
  }

  /**
   * Throttle CPU execution speed via CDP. rate=1 means no throttle, rate=4 means 4x slower (simulates mobile).
   */
  public async setCpuThrottle(rate: number): Promise<void> {
    if (!this._cdp) return;

    try {
      await this._cdp.send('Emulation.setCPUThrottlingRate', { rate: Math.max(1, rate) });
    } catch {
      // best-effort
    }
  }

  /**
   * Send a chat message via the game's network manager.
   * Used to trigger server-side debug commands like /fillzoo.
   */
  public async sendChatMessage(message: string): Promise<void> {
    const page = this._page as any;

    if (!page || !this._connected) return;

    try {
      await page.evaluate((msg: string) => {
        const game = (window as any).__HYTOPIA_GAME__;

        if (game?.networkManager?.sendChatMessagePacket) {
          game.networkManager.sendChatMessagePacket(msg);
        }
      }, message);
    } catch {
      // best-effort
    }
  }

  public async captureTrace(durationMs: number): Promise<object | null> {
    const page = this._page as any;

    if (!page) return null;

    try {
      await page.tracing.start({ categories: ['devtools.timeline', 'v8.execute', 'blink.user_timing'] });

      await new Promise(resolve => setTimeout(resolve, durationMs));

      const buffer = await page.tracing.stop();

      return JSON.parse(buffer.toString());
    } catch {
      return null;
    }
  }

  public async close(): Promise<void> {
    try {
      const browser = this._browser as any;

      if (browser) {
        await browser.close();
      }
    } catch {
      // best-effort cleanup
    } finally {
      this._browser = null;
      this._page = null;
      this._connected = false;
    }
  }

  public get performanceEntries(): ClientSnapshot[] {
    return this._performanceEntries;
  }

  public get isConnected(): boolean {
    return this._connected;
  }
}

type RawPerfSnapshot = Record<string, unknown> | null | undefined;

function normalizeClientMetrics(perfSnapshot: RawPerfSnapshot, fallbackSnapshot: RawPerfSnapshot): Omit<ClientSnapshot, 'timestamp'> | null {
  if (!perfSnapshot && !fallbackSnapshot) {
    return null;
  }

  const perf = asObject(perfSnapshot);
  const fallback = asObject(fallbackSnapshot);
  const perfFrame = asObject(perf?.frame);
  const perfMemory = asObject(perf?.memory);
  const perfEntities = asObject(perf?.entities);
  const perfWorld = asObject(perf?.world);
  const perfChunks = asObject(perf?.chunks);
  const perfGltf = asObject(perf?.gltf);

  const entityCount = asNumber(perfEntities?.count) ?? asNumber(perfWorld?.entityCount);
  const chunkCount = asNumber(perfChunks?.count) ?? asNumber(perfWorld?.chunkCount);
  const visibleChunkCount = asNumber(perfChunks?.visible);

  return {
    source: perf ? 'perf_bridge' : 'webgl_fallback',
    fps: coalesceNumber(
      asNumber(perf?.fps),
      asNumber(perfFrame?.currentFps),
      asNumber(fallback?.fps),
      0,
    ),
    frameTimeMs: coalesceNumber(
      asNumber(perf?.frameTimeMs),
      asNumber(perfFrame?.currentFrameMs),
      asNumber(fallback?.frameTimeMs),
      0,
    ),
    drawCalls: coalesceNumber(
      asNumber(perf?.drawCalls),
      asNumber(fallback?.drawCalls),
      0,
    ),
    triangles: coalesceNumber(
      asNumber(perf?.triangles),
      asNumber(fallback?.triangles),
      0,
    ),
    textureMemoryMb: coalesceNumber(asNumber(perf?.textureMemoryMb), 0),
    geometries: asNumber(perf?.geometries) ?? undefined,
    textures: asNumber(perf?.textures) ?? undefined,
    programs: asNumber(perf?.programs) ?? undefined,
    usedMemoryMb: coalesceNumber(
      asNumber(perf?.usedMemoryMb),
      asNumber(perfMemory?.usedHeapMb),
      asNumber(fallback?.usedMemoryMb),
      0,
    ),
    totalMemoryMb: coalesceNumber(
      asNumber(perf?.totalMemoryMb),
      asNumber(perfMemory?.totalHeapMb),
      asNumber(fallback?.totalMemoryMb),
      0,
    ),
    entities: entityCount === undefined
      ? undefined
      : {
          count: entityCount,
          inViewDistance: coalesceNumber(asNumber(perfEntities?.inViewDistance), entityCount),
          frustumCulled: coalesceNumber(asNumber(perfEntities?.frustumCulled), 0),
          staticEnvironment: coalesceNumber(asNumber(perfEntities?.staticEnvironment), 0),
        },
    chunks: chunkCount === undefined && visibleChunkCount === undefined
      ? undefined
      : {
          count: coalesceNumber(chunkCount, visibleChunkCount, 0),
          visible: coalesceNumber(visibleChunkCount, chunkCount, 0),
          blocks: coalesceNumber(asNumber(perfChunks?.blocks), 0),
          opaqueFaces: coalesceNumber(asNumber(perfChunks?.opaqueFaces), 0),
          transparentFaces: coalesceNumber(asNumber(perfChunks?.transparentFaces), 0),
          liquidFaces: coalesceNumber(asNumber(perfChunks?.liquidFaces), 0),
        },
    gltf: perfGltf
      ? {
          files: coalesceNumber(asNumber(perfGltf?.files), 0),
          sourceMeshes: coalesceNumber(asNumber(perfGltf?.sourceMeshes), 0),
          clonedMeshes: coalesceNumber(asNumber(perfGltf?.clonedMeshes), asNumber(perfGltf?.clonedMeshCount), 0),
          instancedMeshes: coalesceNumber(asNumber(perfGltf?.instancedMeshes), asNumber(perfGltf?.instancedMeshCount), 0),
          drawCallsSaved: coalesceNumber(asNumber(perfGltf?.drawCallsSaved), 0),
        }
      : undefined,
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function coalesceNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return 0;
}
