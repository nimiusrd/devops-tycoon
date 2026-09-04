import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { INDUSTRY_VIEW, planIndustryBoardScene } from '../../../src/render/industryBoardScene';
import { RANKING_KINDS, RANKING_LABEL } from '../../../src/sim/orgscale/industry';
import type { IndustryState, RankingKind } from '../../../src/sim/orgscale/types';
import { dailyRunKey, defaultMeta } from '../../../src/state/meta';
import { AspectStage } from '../../../src/ui/AspectStage';
import { IndustryScreen } from '../../../src/ui/IndustryScreen';
import { IndustrySkyline } from '../../../src/ui/IndustrySkyline';

type Props = Record<string, unknown> & { children?: ReactNode };

// ResizeObserver を持つレイアウト境界だけを残し、画面・スカイラインは実装を展開する。
function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function' && node.type !== AspectStage) {
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function find(node: ReactNode, id: string): ReactElement<Props> {
  const found = elements(node).find((element) => element.props['data-testid'] === id);
  if (!found) throw new Error(`要素がありません: ${id}`);
  return found;
}

function industryFixture(kind: RankingKind = 'overall'): IndustryState {
  return {
    kind,
    season: 3,
    league: 'シルバーリーグ',
    selfRank: 2,
    total: 3,
    entries: ['先頭ソフト', '自社ラボ', '後方技研'].map((name, index) => ({
      rank: index + 1,
      org: {
        id: `org-${index}`,
        name,
        orgType: ['健全加速', 'レビュー渋滞', '文書王国'][index],
        scores: {
          overall: 300 - index * 100,
          healthy: 40 + index,
          ai: 80 + index,
          growth: 9 + index,
        },
        healthRank: ['A', 'B', 'C'][index],
        trend: ([1, 0, -1] as const)[index],
        isSelf: index === 1,
      },
    })),
  };
}

describe('IndustryScreen のランキング表示と切替', () => {
  it.each(RANKING_KINDS)('%s のスコア・選択状態を描き、各タブは切替だけを依頼する', (kind) => {
    const industry = industryFixture(kind);
    const meta = defaultMeta();
    const before = structuredClone({ industry, meta });
    const onSetKind = vi.fn();
    const tree = expand(IndustryScreen({ industry, meta, onSetKind }));

    expect(content(find(tree, 'industry-league'))).toBe('シルバーリーグ');
    expect(content(find(tree, 'industry-selfrank'))).toBe('自社 2 位 / 3 組織');
    expect(content(tree)).toContain('シーズン 3');
    expect(find(tree, 'industry-tabs').props.role).toBe('tablist');
    for (const tabKind of RANKING_KINDS) {
      const tab = find(tree, `rank-tab-${tabKind}`);
      expect(tab.props).toMatchObject({
        type: 'button',
        role: 'tab',
        'aria-selected': tabKind === kind,
      });
      expect(String(tab.props.className).split(' ').includes('active')).toBe(tabKind === kind);
      expect(content(tab)).toBe(RANKING_LABEL[tabKind]);
      (tab.props.onClick as () => void)();
      expect(onSetKind).toHaveBeenLastCalledWith(tabKind);
    }
    expect(onSetKind).toHaveBeenCalledTimes(4);

    const table = find(tree, 'industry-table');
    expect(
      elements(table)
        .filter((node) => node.type === 'th')
        .map(content),
    ).toEqual(['順位', '組織', '組織タイプ', RANKING_LABEL[kind], '健全度', '趨勢']);
    const rows = elements(table)
      .filter((node) => node.type === 'tr')
      .slice(1);
    expect(
      rows.map((row) =>
        elements(row)
          .filter((node) => node.type === 'td')
          .map(content),
      ),
    ).toEqual(
      industry.entries.map((entry, index) => [
        String(entry.rank),
        `${entry.org.isSelf ? '★ ' : ''}${entry.org.name}`,
        entry.org.orgType,
        String(entry.org.scores[kind]),
        entry.org.healthRank,
        ['▲', '→', '▼'][index],
      ]),
    );
    expect(find(tree, 'industry-self-row').props.className).toBe('is-self');
    expect(content(find(tree, 'industry-self-trend'))).toBe('→');
    expect(rows.filter((row) => row.props.className === 'is-self')).toHaveLength(1);
    expect({ industry, meta }).toEqual(before);
  });

  it('デイリー記録がなければ案内を表示し、空の順位リストは表示しない', () => {
    const tree = expand(
      IndustryScreen({ industry: industryFixture(), meta: defaultMeta(), onSetKind: vi.fn() }),
    );
    expect(content(find(tree, 'daily-leaderboard-empty'))).toContain(
      'まだデイリー記録はありません',
    );
    expect(elements(tree).some((node) => node.props['data-testid'] === 'daily-leaderboard')).toBe(
      false,
    );
    expect(
      elements(tree).find((node) => node.props.className === 'daily-leaderboard-count'),
    ).toSatisfy((node: ReactNode) => content(node) === '0 件');
  });

  it('日次ベストを得点順に表示し、旧記録・ルールセット・報酬受領を区別する', () => {
    const ruleset = { version: 7, fingerprint: 'fixture-full-fingerprint' };
    const currentKey = dailyRunKey('2026-09-05', ruleset);
    const earlierKey = dailyRunKey('2026-09-04', ruleset);
    const meta = {
      ...defaultMeta(),
      dailyRuns: {
        [earlierKey]: { bestScore: 2000, rewardClaimed: false },
        '2026-09-03': { bestScore: 9000, rewardClaimed: true },
        [currentKey]: { bestScore: 2000, rewardClaimed: true },
        invalid: { bestScore: 99999, rewardClaimed: true },
      },
    };
    const before = structuredClone(meta);
    const tree = expand(IndustryScreen({ industry: industryFixture(), meta, onSetKind: vi.fn() }));
    const records = elements(find(tree, 'daily-leaderboard')).filter((node) => node.type === 'li');
    expect(records.map((node) => node.props['data-testid'])).toEqual([
      'daily-record-2026-09-03',
      `daily-record-${currentKey}`,
      `daily-record-${earlierKey}`,
    ]);
    expect(
      records
        .map((row) => elements(row).find((node) => node.props.className === 'daily-rank'))
        .map(content),
    ).toEqual(['#1', '#2', '#3']);
    expect(content(records[0])).toContain(`${(9000).toLocaleString()} pt`);
    expect(content(records[0])).toContain('報酬受領済み');
    expect(find(records[0], 'daily-record-ruleset').props['data-ruleset-known']).toBe('false');
    expect(content(find(records[0], 'daily-record-ruleset'))).toBe('ルールセット不明');
    expect(find(records[1], 'daily-record-ruleset').props['data-ruleset-known']).toBe('true');
    expect(content(find(records[1], 'daily-record-ruleset'))).toBe('v7 / fixture-full-fingerprint');
    expect(elements(records[1]).find((node) => node.type === 'time')?.props.dateTime).toBe(
      '2026-09-05',
    );
    expect(content(records[2])).toContain('報酬未受領');
    expect(
      elements(tree).some((node) => node.props['data-testid'] === 'daily-leaderboard-empty'),
    ).toBe(false);
    expect(meta).toEqual(before);
  });
});

describe('IndustrySkyline の表示計画', () => {
  it('奥から順にビルを描き、自社・首位・窓・ラベルを同じ設計座標へ載せる', () => {
    const industry = industryFixture();
    const before = structuredClone(industry);
    const scene = planIndustryBoardScene(industry);
    const tree = expand(IndustrySkyline({ industry }));
    expect(find(tree, 'industry-skyline').props['aria-hidden']).toBe(true);
    expect(find(tree, 'industry-skyline-stage').props.ratio).toBe(
      INDUSTRY_VIEW.w / INDUSTRY_VIEW.h,
    );
    expect(elements(tree).find((node) => node.type === 'svg')?.props).toMatchObject({
      viewBox: `0 0 ${INDUSTRY_VIEW.w} ${INDUSTRY_VIEW.h}`,
      preserveAspectRatio: 'xMidYMax meet',
    });
    const buildings = elements(tree).filter((node) => node.type === 'g');
    expect(buildings.map((node) => node.props['data-rank'])).toEqual([3, 2, 1]);
    expect(find(tree, 'industry-hq-self').props.className).toBe('industry-building tone-self');
    expect(find(tree, 'industry-hq-1').props.className).toBe('industry-building tone-leader');
    expect(find(tree, 'industry-hq-3').props.className).toBe('industry-building tone-rival');
    expect(
      elements(find(tree, 'industry-hq-1')).filter(
        (node) => node.props['data-testid'] === 'industry-hq-crown',
      ),
    ).toHaveLength(1);
    expect(
      elements(find(tree, 'industry-hq-self')).some(
        (node) => node.props['data-testid'] === 'industry-hq-crown',
      ),
    ).toBe(false);
    for (const plan of scene.buildings) {
      const building = find(tree, plan.isSelf ? 'industry-hq-self' : `industry-hq-${plan.rank}`);
      const windows = elements(building).filter((node) => node.type === 'rect');
      expect(windows).toHaveLength(plan.windowRows * 3);
      expect(windows[0].props).toMatchObject({
        x: plan.x - plan.width / 2 + 10,
        y: plan.baseY - plan.height + 18,
        width: '8',
        height: '9',
      });
      expect(elements(building).filter((node) => node.type === 'polygon')).toHaveLength(3);
      const label = elements(tree).find(
        (node) => node.props.className === `industry-hq-label tone-${plan.tone}`,
      )!;
      expect(content(label)).toBe(`${plan.isSelf ? '自社 ' : ''}${plan.rank}位${plan.name}`);
      expect(label.props.style).toEqual({
        left: `${(plan.label.x / INDUSTRY_VIEW.w) * 100}%`,
        top: `${(plan.label.y / INDUSTRY_VIEW.h) * 100}%`,
      });
    }
    expect(industry).toEqual(before);
  });

  it('自社首位には王冠を重ね、空のランキングでも空のスカイラインを描ける', () => {
    const industry = industryFixture();
    industry.entries = [{ ...industry.entries[1], rank: 1 }];
    industry.selfRank = 1;
    const self = find(expand(IndustrySkyline({ industry })), 'industry-hq-self');
    expect(content(find(self, 'industry-hq-crown'))).toBe('👑');
    expect(self.props.className).toBe('industry-building tone-self');
    const empty = expand(IndustrySkyline({ industry: { ...industry, entries: [] } }));
    expect(elements(empty).filter((node) => node.type === 'g')).toHaveLength(0);
    expect(
      elements(empty).filter((node) =>
        String(node.props.className).startsWith('industry-hq-label'),
      ),
    ).toHaveLength(0);
  });
});
