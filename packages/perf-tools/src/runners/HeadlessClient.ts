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
        '--use-gl=swiftshader',
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

    const cdp = await page.createCDPSession();

    // Bypass certificate errors via CDP (--ignore-certificate-errors doesn't work in headless: 'new')
    await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });

    if (this._options.collectPerformance) {
      await cdp.send('Performance.enable');
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
