import Entity from '@/worlds/entities/Entity';
import SimpleEntityController from '@/worlds/entities/controllers/SimpleEntityController';
import { RigidBodyType } from '@/worlds/physics/RigidBody';
import type World from '@/worlds/World';
import type Vector3Like from '@/shared/types/math/Vector3Like';

export interface BotBehavior {
  name: string;
  tick(bot: BotPlayer, world: World, deltaTimeMs: number): void;
}

export interface BotPlayerOptions {
  name?: string;
  behavior?: BotBehavior;
  spawnPosition?: Vector3Like;
  modelUri?: string;
  modelScale?: number;
  rigidBodyType?: RigidBodyType;
}

let botIdCounter = 0;

export default class BotPlayer {
  public readonly id: number;
  public readonly entity: Entity;
  public readonly name: string;

  private _behavior: BotBehavior | null;
  private _world: World;
  private _spawned: boolean = false;

  constructor(world: World, options?: BotPlayerOptions) {
    this.id = ++botIdCounter;
    this.name = options?.name ?? `Bot-${this.id}`;
    this._world = world;
    this._behavior = options?.behavior ?? null;

    const controller = new SimpleEntityController();
    const rigidBodyType = options?.rigidBodyType ?? RigidBodyType.KINEMATIC_POSITION;

    this.entity = new Entity({
      name: this.name,
      modelUri: options?.modelUri ?? 'models/players/player.gltf',
      modelScale: options?.modelScale ?? 1,
      controller,
      rigidBodyOptions: {
        type: rigidBodyType,
        ...(rigidBodyType === RigidBodyType.DYNAMIC
          ? { enabledRotations: { x: false, y: true, z: false } }
          : {}),
      },
    });

    this.entity.on('ENTITY.TICK', ({ tickDeltaMs }: { tickDeltaMs: number }) => {
      if (this._behavior) {
        this._behavior.tick(this, this._world, tickDeltaMs);
      }
    });
  }

  public get isSpawned(): boolean {
    return this._spawned;
  }

  public get world(): World {
    return this._world;
  }

  public get controller(): SimpleEntityController {
    return this.entity.controller as SimpleEntityController;
  }

  public setBehavior(behavior: BotBehavior): void {
    this._behavior = behavior;
  }

  public spawn(position?: Vector3Like): void {
    if (this._spawned) return;

    const pos = position ?? { x: 0, y: 10, z: 0 };

    this.entity.spawn(this._world, pos);
    this._spawned = true;
  }

  public teleport(position: Vector3Like): void {
    if (!this._spawned) return;

    this.entity.setPosition(position);
  }

  public despawn(): void {
    if (!this._spawned) return;

    this.entity.despawn();
    this._spawned = false;
  }
}
