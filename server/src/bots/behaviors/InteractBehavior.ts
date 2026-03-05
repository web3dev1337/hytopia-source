import type { BotBehavior } from '@/bots/BotPlayer';
import type BotPlayer from '@/bots/BotPlayer';
import type World from '@/worlds/World';

export interface InteractBehaviorOptions {
  interactRadius?: number;
  actionIntervalMs?: number;
  moveSpeed?: number;
}

export default class InteractBehavior implements BotBehavior {
  public readonly name = 'interact';

  private _interactRadius: number;
  private _actionIntervalMs: number;
  private _moveSpeed: number;

  private _elapsed: number = 0;
  private _moveElapsed: number = 0;
  private _originX: number = 0;
  private _originZ: number = 0;
  private _originSet: boolean = false;

  constructor(options?: InteractBehaviorOptions) {
    this._interactRadius = options?.interactRadius ?? 15;
    this._actionIntervalMs = options?.actionIntervalMs ?? 2000;
    this._moveSpeed = options?.moveSpeed ?? 3;
  }

  public tick(bot: BotPlayer, world: World, deltaTimeMs: number): void {
    if (!bot.isSpawned) return;

    if (!this._originSet) {
      const pos = bot.entity.position;

      this._originX = pos.x;
      this._originZ = pos.z;
      this._originSet = true;
    }

    this._moveElapsed += deltaTimeMs;

    if (this._moveElapsed >= 3000) {
      this._moveElapsed = 0;
      this._moveToRandom(bot);
    }

    this._elapsed += deltaTimeMs;

    if (this._elapsed < this._actionIntervalMs) return;

    this._elapsed = 0;

    const pos = bot.entity.position;
    const offsetX = Math.floor((Math.random() - 0.5) * 4);
    const offsetZ = Math.floor((Math.random() - 0.5) * 4);
    const targetX = Math.floor(pos.x) + offsetX;
    const targetZ = Math.floor(pos.z) + offsetZ;
    const targetY = Math.floor(pos.y) - 1;

    const action = Math.random();

    if (action < 0.5) {
      try {
        world.chunkLattice.setBlock({ x: targetX, y: targetY + 2, z: targetZ }, 1);
      } catch {
        // block placement may fail if invalid position
      }
    } else {
      try {
        world.chunkLattice.setBlock({ x: targetX, y: targetY + 2, z: targetZ }, 0);
      } catch {
        // block removal may fail
      }
    }
  }

  private _moveToRandom(bot: BotPlayer): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this._interactRadius;
    const pos = bot.entity.position;

    bot.controller.move(
      {
        x: this._originX + Math.cos(angle) * distance,
        y: pos.y,
        z: this._originZ + Math.sin(angle) * distance,
      },
      this._moveSpeed,
    );
  }
}
