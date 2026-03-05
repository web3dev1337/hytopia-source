import type { BotBehavior } from '@/bots/BotPlayer';
import type BotPlayer from '@/bots/BotPlayer';
import type World from '@/worlds/World';

export interface ChaseBehaviorOptions {
  chaseSpeed?: number;
  detectionRadius?: number;
  updateIntervalMs?: number;
}

export default class ChaseBehavior implements BotBehavior {
  public readonly name = 'chase';

  private _chaseSpeed: number;
  private _detectionRadius: number;
  private _updateIntervalMs: number;

  private _elapsed: number = 0;

  constructor(options?: ChaseBehaviorOptions) {
    this._chaseSpeed = options?.chaseSpeed ?? 5;
    this._detectionRadius = options?.detectionRadius ?? 50;
    this._updateIntervalMs = options?.updateIntervalMs ?? 500;
  }

  public tick(bot: BotPlayer, world: World, deltaTimeMs: number): void {
    if (!bot.isSpawned) return;

    this._elapsed += deltaTimeMs;

    if (this._elapsed < this._updateIntervalMs) return;

    this._elapsed = 0;

    const botPos = bot.entity.position;
    let closestDist = this._detectionRadius * this._detectionRadius;
    let closestPos: { x: number; y: number; z: number } | null = null;

    for (const entity of world.entityManager.getAllEntities()) {
      if (entity === bot.entity) continue;
      if (!entity.isSpawned) continue;

      const pos = entity.position;
      const dx = pos.x - botPos.x;
      const dz = pos.z - botPos.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < closestDist) {
        closestDist = distSq;
        closestPos = { x: pos.x, y: pos.y, z: pos.z };
      }
    }

    if (closestPos) {
      bot.controller.move(closestPos, this._chaseSpeed);
      bot.controller.face(closestPos, 8);
    }
  }
}
