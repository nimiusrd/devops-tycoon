/**
 * 四半期ボスの決定論抽選。engine と見通し投影が同じ式を使う。
 */
import { BOSS_DEFS } from '../../data/bosses';
import { createRng } from '../rng';

/** `RunEngine.pickBoss` と同じ seed 契約。 */
export function pickQuarterBossId(seed: string, quarterNumber: number): string {
  const rng = createRng(`${seed}:boss:q${quarterNumber}`);
  const ids = BOSS_DEFS.map((b) => b.id);
  return ids[Math.floor(rng() * ids.length)]!;
}
