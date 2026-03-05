import { WebSocket } from 'ws';

export interface WsClientOptions {
  url: string;
}

export default class WsClient {
  private _ws: WebSocket | null = null;
  private _options: WsClientOptions;

  constructor(options: WsClientOptions) {
    this._options = options;
  }

  public async connect(): Promise<void> {
    if (this._ws) return;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this._options.url);

      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };

      const onOpen = () => {
        cleanup();
        this._ws = ws;
        resolve();
      };

      const onError = (err: unknown) => {
        cleanup();
        try { ws.close(); } catch { /* NOOP */ }
        reject(err);
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('message', () => {});
    });
  }

  public async close(): Promise<void> {
    const ws = this._ws;
    this._ws = null;

    if (!ws) return;

    await new Promise<void>(resolve => {
      ws.once('close', () => resolve());
      try {
        ws.close();
      } catch {
        resolve();
      }
    });
  }
}

