import BotPlayer from '@/bots/BotPlayer';
import type { BotPlayerOptions } from '@/bots/BotPlayer';
import type World from '@/worlds/World';

export default class BotManager {
  private static _instance: BotManager;

  public static get instance(): BotManager {
    if (!BotManager._instance) {
      BotManager._instance = new BotManager();
    }

    return BotManager._instance;
  }

  private _bots: Map<number, BotPlayer> = new Map();

  public get botCount(): number {
    return this._bots.size;
  }

  public spawnBot(world: World, options?: BotPlayerOptions): BotPlayer {
    const bot = new BotPlayer(world, options);

    bot.spawn(options?.spawnPosition);
    this._bots.set(bot.id, bot);

    return bot;
  }

  public spawnBots(world: World, count: number, options?: BotPlayerOptions): BotPlayer[] {
    const bots: BotPlayer[] = [];

    for (let i = 0; i < count; i++) {
      const botOptions: BotPlayerOptions = {
        ...options,
        name: options?.name ? `${options.name}-${i + 1}` : undefined,
      };

      bots.push(this.spawnBot(world, botOptions));
    }

    return bots;
  }

  public getBot(id: number): BotPlayer | undefined {
    return this._bots.get(id);
  }

  public getAllBots(): BotPlayer[] {
    return Array.from(this._bots.values());
  }

  public despawnBot(id: number): void {
    const bot = this._bots.get(id);

    if (bot) {
      bot.despawn();
      this._bots.delete(id);
    }
  }

  public despawnAll(): void {
    for (const bot of this._bots.values()) {
      bot.despawn();
    }

    this._bots.clear();
  }
}
