import { describe, expect, it } from 'vitest';
import { BOSS_TEMPLATES } from '../../../src/data/bosses';
import { getBoss } from '../../../src/data/bossDisplay';
import {
  BOSS_DESCRIPTION_SIM_ANCHORS,
  planBossPlayerDescription,
} from '../../../src/data/bossPlayerCopy';
import { REVIEW_FREEZE_LOSE_NAME } from '../../../src/render/reviewFreezeCopy';
import { getDifficulty } from '../../../src/data/difficulties';

describe('bossPlayerCopy（#1011）', () => {
  it('説明にレビュー凍結の閾値と名前が含まれる', () => {
    for (const boss of BOSS_TEMPLATES) {
      const text = planBossPlayerDescription(boss, 'normal');
      expect(text).toContain(String(BOSS_DESCRIPTION_SIM_ANCHORS.reviewFreezePeak));
      expect(text).toContain(REVIEW_FREEZE_LOSE_NAME);
    }
  });

  it('セキュリティ監査は負債上限と品質下限を突破条件として述べる', () => {
    const boss = getBoss('security-audit')!;
    const text = planBossPlayerDescription(boss, 'normal');
    expect(text).toContain('Tech Debt 40 以下');
    expect(text).toContain('Quality 50 以上');
    expect(text).not.toContain('高いほど失点');
  });

  it('説明の出荷目標は難易度の bossTargetMul を反映する', () => {
    const boss = getBoss('big-release')!;
    const mul = getDifficulty('easy').bossTargetMul;
    const target = Math.ceil((boss.clear.minSprintDelivered ?? 0) * mul);
    const easyText = planBossPlayerDescription(boss, 'easy');
    expect(easyText).toContain(`スプリント出荷 ${target}pt 以上`);
  });
});
