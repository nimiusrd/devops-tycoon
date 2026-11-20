import { describe, expect, it } from 'vitest';
import { EVOLUTION_NODES } from '../../../src/data/evolution';
import { companyProfileView } from '../../../src/render/companyProfileView';
import { RunEngine } from '../../../src/sim/run/engine';
import { createReplayContentResolver } from '../../../src/ui/replayContentCore';

function setup() {
  const engine = new RunEngine({ seed: 'company-profile', difficulty: 'easy' });
  engine.startRun();
  return engine.snapshot();
}

const liveContent = createReplayContentResolver(null);

describe('会社プロフィール', () => {
  it('解放状況と前提・不足を現在の進化状態から導出する', () => {
    const state = setup();
    state.evolution = { points: 2, unlocked: { 'dev-1': true, 'review-1': true } };
    const before = structuredClone(state);
    const profile = companyProfileView(state, liveContent);

    expect(profile).toMatchObject({ unlockedCount: 2, evolutionCount: 15, points: 2 });
    const review = profile.branches.find((branch) => branch.branch === 'review')!;
    expect(review.unlockedCount).toBe(1);
    expect(review.next).toMatchObject({
      id: 'review-2',
      status: 'ポイント不足',
      cost: 3,
      shortfall: 1,
      prerequisite: { name: 'レビュー容量増強', met: true },
    });
    expect(review.nodes).toMatchObject([
      { id: 'review-1', status: '解放済み' },
      { id: 'review-2', status: 'ポイント不足' },
      {
        id: 'review-3',
        status: '前提未達',
        prerequisite: { name: '自動レビュー解放', met: false },
      },
    ]);
    expect(state).toEqual(before);
    state.evolution.points = 3;
    const eligible = companyProfileView(state, liveContent);
    expect(eligible.branches.find((branch) => branch.branch === 'review')?.next?.status).toBe(
      '解放可能',
    );
  });

  it('全系統の解放完了時に次候補を作らず、空の所持・編成をそのまま返す', () => {
    const state = setup();
    state.evolution.unlocked = Object.fromEntries(EVOLUTION_NODES.map((node) => [node.id, true]));
    state.deck = [];
    state.relics = [];
    state.roster.members = [];
    const profile = companyProfileView(state, liveContent);
    expect(profile.branches.every((branch) => branch.next === undefined)).toBe(true);
    expect(profile.unlockedCount).toBe(EVOLUTION_NODES.length);
    expect(profile).toMatchObject({ cards: [], relics: [], members: [] });
  });

  it('重名の人物をチーム内のIDで区別し、保存されたカード・レリック定義を使う', () => {
    const state = setup();
    const activeTeam = state.teams.find((team) => team.id === state.activeTeamId)!;
    activeTeam.name = '検証中チーム';
    state.roster.members[0] = {
      ...state.roster.members[0],
      name: '同じ名前',
      level: 7,
      rank: 'senior',
      onLeave: true,
    };
    state.roster.members[1].name = '同じ名前';
    state.deck = [{ defId: 'copilot', level: 2 }];
    state.relics = ['small-pr'];
    const recorded = createReplayContentResolver({
      cards: [{ ...liveContent.resolveCard('copilot'), name: '記録されたカード' }],
      relics: [{ ...liveContent.resolveRelic('small-pr'), name: '記録された文化' }],
    });

    const profile = companyProfileView(state, recorded);
    expect(profile.teamName).toBe('検証中チーム');
    expect(profile.members.slice(0, 2)).toMatchObject([
      { id: state.roster.members[0].id, name: '同じ名前', level: 7, rank: 'シニア', onLeave: true },
      { id: state.roster.members[1].id, name: '同じ名前' },
    ]);
    expect(profile.cards).toMatchObject([{ name: '記録されたカード', level: 2 }]);
    expect(profile.relics).toMatchObject([{ name: '記録された文化' }]);
  });
});
