/**
 * RI-91-C3: src/sim/cards.ts の NoCoverage / Survived mutation を潰す。
 * 共有の cards.test.ts は触らず、単位専用ファイルで exact / 境界断言する。
 */
import { describe, expect, it } from 'vitest';
import {
  emptyCardPiles,
  inheritBaselineAppliedForTeams,
  migrateBaselineAppliedByTeam,
  playCardFromHand,
  playCost,
  scaleEffects,
  upgradeCard,
  upgradeCardAt,
} from '../../src/sim/cards';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import type { CardInstance } from '../../src/sim/types';

describe('RI-91-C3 cards NoCoverage / Survived mutants', () => {
  describe('emptyCardPiles', () => {
    it('4 山すべて空配列の山を返す', () => {
      expect(emptyCardPiles()).toEqual({
        drawOrder: [],
        hand: [],
        discard: [],
        played: [],
      });
    });
  });

  describe('playCardFromHand 失敗経路', () => {
    const org = () => createOrgState('default', true);
    const baseSprint = () => createSprint(resolveSprintConfig('default'), org(), () => 0.5);

    it('complete スプリントは reason complete で拒否する', () => {
      const sprint = baseSprint();
      sprint.complete = true;
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'copilot', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'complete',
      });
    });

    it('手札に無い deckIndex は reason no-card で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'copilot', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 1)).toEqual({
        ok: false,
        reason: 'no-card',
      });
    });

    it('deck 欠落は reason invalid で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('未知 defId は reason invalid で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'does-not-exist', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });
  });

  describe('migrateBaselineAppliedByTeam / inheritBaselineAppliedForTeams', () => {
    it('空の teamIds は同一参照を返す', () => {
      const deck: CardInstance[] = [{ defId: 'auto-test', level: 2, baselineAppliedLevel: 1 }];
      expect(migrateBaselineAppliedByTeam(deck, [])).toBe(deck);
    });

    it('空の newTeamIds は同一参照を返す', () => {
      const deck: CardInstance[] = [
        { defId: 'auto-test', level: 2, baselineAppliedByTeam: { home: 1 } },
      ];
      expect(inheritBaselineAppliedForTeams(deck, 'home', [])).toBe(deck);
    });

    it('inherited===0 のカードは不変（<=0 ガード）', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 2, baselineAppliedByTeam: { home: 0 } },
      ];
      const next = inheritBaselineAppliedForTeams(deck, 'home', ['spawn']);
      expect(next[0]).toBe(deck[0]);
      expect(next[1]).toBe(deck[1]);
      expect(next[0]!.baselineAppliedByTeam).toBeUndefined();
      expect(next[1]!.baselineAppliedByTeam).toEqual({ home: 0 });
    });

    it('正の inherited を新チームへ Math.max で継承する', () => {
      const deck: CardInstance[] = [
        {
          defId: 'auto-test',
          level: 3,
          baselineAppliedByTeam: { home: 2, spawn: 3 },
        },
      ];
      const next = inheritBaselineAppliedForTeams(deck, 'home', ['spawn', 'other']);
      expect(next[0]!.baselineAppliedByTeam).toEqual({
        home: 2,
        spawn: 3, // 既存 3 > inherited 2
        other: 2,
      });
      expect(next[0]).not.toBe(deck[0]);
    });
  });

  describe('upgradeCard / upgradeCardAt', () => {
    it('upgradeCard は先頭一致の defId だけを強化する', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 1 },
        { defId: 'auto-test', level: 1 },
      ];
      const next = upgradeCard(deck, 'auto-test');
      expect(next[0]!.level).toBe(1);
      expect(next[0]!.defId).toBe('copilot');
      expect(next[1]!.level).toBe(2);
      expect(next[2]!.level).toBe(1);
    });

    it('upgradeCardAt は範囲外 index で同一参照を返す', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 1 },
      ];
      expect(upgradeCardAt(deck, -1)).toBe(deck);
      expect(upgradeCardAt(deck, deck.length)).toBe(deck);
      expect(upgradeCardAt(deck, deck.length + 1)).toBe(deck);
      expect(deck[0]!.level).toBe(1);
      expect(deck[1]!.level).toBe(1);
    });
  });

  describe('playCost / scaleEffects exact', () => {
    it('playCost は round(cost/4) と強化減・下限1を固定する', () => {
      expect(playCost(6, 1)).toBe(2); // round(6/4)=2
      expect(playCost(10, 1)).toBe(3);
      expect(playCost(10, 4)).toBe(1); // base 3 - 3 → 下限 1
      expect(playCost(1, 1)).toBe(1); // max(1, round(0.25))=1
    });

    it('scaleEffects はレベル係数 k=1+0.5*max(0,level-1) を exact で返す', () => {
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 1).codingSpeedMul).toBe(1.15);
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 0).codingSpeedMul).toBe(1.15); // level<=1 → k=1
      // 1 + (1.15-1)*1.5 — IEEE754 で 1.224999… になるため式で固定する
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 2).codingSpeedMul).toBe(1 + (1.15 - 1) * 1.5);
      expect(scaleEffects({ qualityAdd: 10 }, 2).qualityAdd).toBe(15);
      expect(scaleEffects({ qualityAdd: 10 }, 1).qualityAdd).toBe(10);
    });
  });
});
