export interface NetworkMetricsSnapshot {
  connectedPlayers: number;
  bytesSentTotal: number;
  bytesReceivedTotal: number;
  bytesSentPerSecond: number;
  bytesReceivedPerSecond: number;
  packetsSentPerSecond: number;
  packetsReceivedPerSecond: number;
  avgSerializationMs: number;
  compressionCount: number;
}

export default class NetworkMetrics {
  private static _instance: NetworkMetrics;

  public static get instance(): NetworkMetrics {
    if (!NetworkMetrics._instance) {
      NetworkMetrics._instance = new NetworkMetrics();
    }

    return NetworkMetrics._instance;
  }

  private _enabled: boolean = false;

  private _bytesSentTotal: number = 0;
  private _bytesReceivedTotal: number = 0;
  private _packetsSentTotal: number = 0;
  private _packetsReceivedTotal: number = 0;
  private _compressionCount: number = 0;

  private _serializationTotalMs: number = 0;
  private _serializationCount: number = 0;

  private _lastSnapshotTime: number = 0;
  private _lastBytesSent: number = 0;
  private _lastBytesReceived: number = 0;
  private _lastPacketsSent: number = 0;
  private _lastPacketsReceived: number = 0;

  private _connectedPlayers: number = 0;

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public enable(): void {
    this._enabled = true;
    this._lastSnapshotTime = performance.now();
    this._reset();
  }

  public disable(): void {
    this._enabled = false;
  }

  public reset(): void {
    this._lastSnapshotTime = performance.now();
    this._reset();
  }

  public setConnectedPlayers(count: number): void {
    this._connectedPlayers = count;
  }

  public recordBytesSent(bytes: number): void {
    if (!this._enabled) return;
    this._bytesSentTotal += bytes;
  }

  public recordBytesReceived(bytes: number): void {
    if (!this._enabled) return;
    this._bytesReceivedTotal += bytes;
  }

  public recordPacketSent(): void {
    if (!this._enabled) return;
    this._packetsSentTotal++;
  }

  public recordPacketReceived(): void {
    if (!this._enabled) return;
    this._packetsReceivedTotal++;
  }

  public recordSerialization(durationMs: number): void {
    if (!this._enabled) return;
    this._serializationTotalMs += durationMs;
    this._serializationCount++;
  }

  public recordCompression(): void {
    if (!this._enabled) return;
    this._compressionCount++;
  }

  public getSnapshot(): NetworkMetricsSnapshot {
    const now = performance.now();
    const elapsedS = Math.max((now - this._lastSnapshotTime) / 1000, 0.001);

    const snapshot: NetworkMetricsSnapshot = {
      connectedPlayers: this._connectedPlayers,
      bytesSentTotal: this._bytesSentTotal,
      bytesReceivedTotal: this._bytesReceivedTotal,
      bytesSentPerSecond: (this._bytesSentTotal - this._lastBytesSent) / elapsedS,
      bytesReceivedPerSecond: (this._bytesReceivedTotal - this._lastBytesReceived) / elapsedS,
      packetsSentPerSecond: (this._packetsSentTotal - this._lastPacketsSent) / elapsedS,
      packetsReceivedPerSecond: (this._packetsReceivedTotal - this._lastPacketsReceived) / elapsedS,
      avgSerializationMs: this._serializationCount > 0
        ? this._serializationTotalMs / this._serializationCount
        : 0,
      compressionCount: this._compressionCount,
    };

    this._lastSnapshotTime = now;
    this._lastBytesSent = this._bytesSentTotal;
    this._lastBytesReceived = this._bytesReceivedTotal;
    this._lastPacketsSent = this._packetsSentTotal;
    this._lastPacketsReceived = this._packetsReceivedTotal;

    return snapshot;
  }

  private _reset(): void {
    this._bytesSentTotal = 0;
    this._bytesReceivedTotal = 0;
    this._packetsSentTotal = 0;
    this._packetsReceivedTotal = 0;
    this._compressionCount = 0;
    this._serializationTotalMs = 0;
    this._serializationCount = 0;
    this._lastBytesSent = 0;
    this._lastBytesReceived = 0;
    this._lastPacketsSent = 0;
    this._lastPacketsReceived = 0;
  }
}
