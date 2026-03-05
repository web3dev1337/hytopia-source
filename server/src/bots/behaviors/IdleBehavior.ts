import type { BotBehavior } from '@/bots/BotPlayer';
import type BotPlayer from '@/bots/BotPlayer';
import type World from '@/worlds/World';

export default class IdleBehavior implements BotBehavior {
  public readonly name = 'idle';

  public tick(_bot: BotPlayer, _world: World, _deltaTimeMs: number): void {
    // no-op: bot stands still, used for baseline load testing
  }
}
