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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
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

    if (this._options.collectPerformance) {
      const cdp = await page.createCDPSession();

      await cdp.send('Performance.enable');
    }
  }

  public async navigate(url?: string): Promise<void> {
    const page = this._page as any;

    if (!page) throw new Error('Client not launched. Call launch() first.');

    const target = url ?? this._options.url;

    await page.goto(target, { waitUntil: 'networkidle2', timeout: 30000 });
    this._connected = true;
  }

  public async collectClientMetrics(): Promise<ClientSnapshot | null> {
    const page = this._page as any;

    if (!page || !this._connected) return null;

    try {
      const metrics = await page.evaluate(() => {
        const perf = (window as any).__HYTOPIA_PERF__;

        if (!perf) return null;

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
