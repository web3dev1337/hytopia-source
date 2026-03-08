import type { BotBehavior } from '@/bots/BotPlayer';
import type BotPlayer from '@/bots/BotPlayer';
import type World from '@/worlds/World';

export interface RandomWalkOptions {
  moveRadius?: number;
  moveSpeed?: number;
  changeDirectionIntervalMs?: number;
}

export default class RandomWalkBehavior implements BotBehavior {
  public readonly name = 'random_walk';

  private _moveRadius: number;
  private _moveSpeed: number;
  private _changeIntervalMs: number;

  private _elapsed: number = 0;
  private _originX: number = 0;
  private _originZ: number = 0;
  private _originSet: boolean = false;

  constructor(options?: RandomWalkOptions) {
    this._moveRadius = options?.moveRadius ?? 20;
    this._moveSpeed = options?.moveSpeed ?? 4;
    this._changeIntervalMs = options?.changeDirectionIntervalMs ?? 3000;
  }

  public tick(bot: BotPlayer, _world: World, deltaTimeMs: number): void {
    if (!bot.isSpawned) return;

    if (!this._originSet) {
      const pos = bot.entity.position;

      this._originX = pos.x;
      this._originZ = pos.z;
      this._originSet = true;
      this._pickNewTarget(bot);
    }

    this._elapsed += deltaTimeMs;

    if (this._elapsed >= this._changeIntervalMs) {
      this._elapsed = 0;
      this._pickNewTarget(bot);
    }
  }

  private _pickNewTarget(bot: BotPlayer): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this._moveRadius;

    const targetX = this._originX + Math.cos(angle) * distance;
    const targetZ = this._originZ + Math.sin(angle) * distance;
    const pos = bot.entity.position;

    bot.controller.move(
      { x: targetX, y: pos.y, z: targetZ },
      this._moveSpeed,
    );

    bot.controller.face(
      { x: targetX, y: pos.y, z: targetZ },
      5,
    );
  }
}
