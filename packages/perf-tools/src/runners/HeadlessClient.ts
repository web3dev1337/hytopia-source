import type { ClientSnapshot } from './MetricCollector.js';

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

          return perf && typeof perf.snapshot === 'function';
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

        if (!perf) return null;

        // Prefer snapshot() method (rich data), fall back to flat properties
        if (typeof perf.snapshot === 'function') {
          return perf.snapshot();
        }

        return {
          fps: perf.fps ?? 0,
          frameTimeMs: perf.frameTimeMs ?? 0,
          drawCalls: perf.drawCalls ?? 0,
          triangles: perf.triangles ?? 0,
          textureMemoryMb: perf.textureMemoryMb ?? 0,
        };
      });

      if (!metrics) return null;

      const snapshot: ClientSnapshot = {
        timestamp: Date.now(),
        ...metrics,
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
