import ErrorHandler from '@/errors/ErrorHandler';
import PerformanceMonitor from '@/metrics/PerformanceMonitor';
import PlayerEntity from '@/worlds/entities/PlayerEntity';
import type Entity from '@/worlds/entities/Entity';
import type Player from '@/players/Player';
import type World from '@/worlds/World';

/**
 * Manages entities in a world.
 *
 * When to use: querying and filtering entities within a specific world.
 * Do NOT use for: cross-world queries; access each world's manager separately.
 *
 * @remarks
 * The EntityManager is created internally per `World` instance.
 *
 * @example
 * ```typescript
 * // Get all entities in the world
 * const entityManager = world.entityManager;
 * const entities = entityManager.getAllEntities();
 * ```
 *
 * **Category:** Entities
 * @public
 */
export default class EntityManager {
  /** @internal */
  private _activeEntities: Set<Entity> = new Set();

  /** @internal */
  private _entities: Map<number, Entity> = new Map();

  /** @internal */
  private _nextEntityId: number = 1;

  /** @internal */
  private _world: World;

  /** @internal */
  public constructor(world: World) {
    this._world = world;
  }

  /**
   * The number of spawned entities in the world.
   *
   * **Category:** Entities
   */
  public get entityCount(): number {
    return this._entities.size;
  }

  /**
   * The world this manager is for.
   *
   * **Category:** Entities
   */
  public get world(): World { return this._world; }

  /** @internal */
  public registerEntity(entity: Entity): number {
    if (entity.id !== undefined) {
      ErrorHandler.fatalError(`EntityManager.registerEntity(): Entity ${entity.name} is already assigned the id ${entity.id}!`);
    }

    const id = this._nextEntityId;
    this._entities.set(id, entity);
    this._nextEntityId++;

    if (!entity.isEnvironmental) {
      this._activeEntities.add(entity);
    }

    return id;
  }

  /** @internal */
  public unregisterEntity(entity: Entity): void {
    if (entity.id === undefined) {
      return ErrorHandler.error(`EntityManager.unregisterEntity(): Entity ${entity.name} is not assigned an id!`);
    }

    this._entities.delete(entity.id);

    if (!entity.isEnvironmental) {
      this._activeEntities.delete(entity);
    }
  }

  /**
   * Gets all spawned entities in the world.
   *
   * @returns All spawned entities in the world.
   *
   * **Category:** Entities
   */
  public getAllEntities(): Entity[] {
    return Array.from(this._entities.values());
  }

  /**
   * Gets all spawned player entities in the world.
   *
   * @returns All spawned player entities in the world.
   *
   * **Category:** Entities
   */
  public getAllPlayerEntities(): PlayerEntity[] {
    const playerEntities: PlayerEntity[] = [];

    this._entities.forEach(entity => {
      if (entity instanceof PlayerEntity) {
        playerEntities.push(entity);
      }
    });

    return playerEntities;
  }

  /**
   * Gets all spawned player entities in the world assigned to the provided player.
   *
   * @param player - The player to get the entities for.
   * @returns All spawned player entities in the world assigned to the player.
   *
   * **Category:** Entities
   */
  public getPlayerEntitiesByPlayer(player: Player): PlayerEntity[] {
    const playerEntities: PlayerEntity[] = [];
    
    this._entities.forEach(entity => {
      if (entity instanceof PlayerEntity && entity.player === player) {
        playerEntities.push(entity);
      }
    });

    return playerEntities;
  }

  /**
   * Gets a spawned entity in the world by its ID.
   *
   * @param id - The ID of the entity to get.
   * @returns The spawned entity with the provided ID, or undefined if no entity is found.
   *
   * **Category:** Entities
   */
  public getEntity<T extends Entity>(id: number): T | undefined {
    return this._entities.get(id) as T | undefined;
  }

  /**
   * Gets all spawned entities in the world with a specific tag.
   *
   * @param tag - The tag to get the entities for.
   * @returns All spawned entities in the world with the provided tag.
   *
   * **Category:** Entities
   */
  public getEntitiesByTag(tag: string): Entity[] {
    const entities: Entity[] = [];

    this._entities.forEach(entity => {
      if (entity.tag === tag) {
        entities.push(entity);
      }
    });

    return entities;
  }

  /**
   * Gets all spawned entities in the world with a tag that includes a specific substring.
   *
   * @param tagSubstring - The tag substring to get the entities for.
   * @returns All spawned entities in the world with a tag that includes the provided substring.
   *
   * **Category:** Entities
   */
  public getEntitiesByTagSubstring(tagSubstring: string): Entity[] {
    const entities: Entity[] = [];

    this._entities.forEach(entity => {
      if (entity.tag?.includes(tagSubstring)) {
        entities.push(entity);
      }
    });

    return entities;
  }

  /**
   * Gets all child entities of an entity.
   *
   * @remarks
   * Direct children only; does not include recursive descendants.
   *
   * @param entity - The entity to get the children for.
   * @returns All direct child entities of the entity.
   *
   * **Category:** Entities
   */
  public getEntityChildren(entity: Entity): Entity[] {
    const entities: Entity[] = [];

    this._entities.forEach(child => {
      if (child.parent === entity) {
        entities.push(child);
      }
    });

    return entities;
  }

  /** @internal */
  public tickEntities(tickDeltaMs: number): void {
    const perfMon = PerformanceMonitor.instance;
    const entityProfiling = perfMon.isEntityProfilingEnabled;

    for (const entity of this._activeEntities) {
      if (entityProfiling) {
        const start = performance.now();
        entity.tick(tickDeltaMs);
        perfMon.recordEntityCost(entity.id ?? 0, entity.name, performance.now() - start);
      } else {
        entity.tick(tickDeltaMs);
      }
    }
  }

  /** @internal */
  public checkAndEmitUpdates(): void {
    for (const entity of this._activeEntities) {
      entity.checkAndEmitUpdates();
    }
  }
}
