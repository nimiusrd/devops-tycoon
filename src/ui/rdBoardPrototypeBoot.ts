import type { GameHandle } from '../game';
import { resolveRdSceneFromLocation } from '../render/rdBoardLayout';

let rdPrototypeBooted = false;

/** `?rdScene=stress` のときだけ、固定場面を 1 回載せる。 */
export function bootRdBoardPrototypeIfNeeded(game: GameHandle): boolean {
  if (rdPrototypeBooted) return false;
  if (resolveRdSceneFromLocation() !== 'stress') return false;
  rdPrototypeBooted = true;
  game.loadRdBoardPrototypeScene();
  return true;
}

/** テスト用。 */
export function resetRdBoardPrototypeBootForTests(): void {
  rdPrototypeBooted = false;
}
