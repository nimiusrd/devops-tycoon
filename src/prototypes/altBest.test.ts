import { describe, expect, it } from 'vitest';
import { applyDailyRunReward, applyRunReward, defaultMeta } from '../state/meta';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';
import {
  altBestKey,
  evaluateAltBests,
  measureAltBest,
  recordAltBest,
  type AltBestInput,
} from './altBest';
import data from '../../docs/prototypes/alt-best-wins.json';
import comparison from '../../docs/prototypes/alt-best-comparison.json';

const inputs = data.wins.map((win) => win.input as AltBestInput);

function won(overrides: Partial<AltBestInput> = {}): AltBestInput {
  return {
    status: 'won',
    runKind: 'normal',
    difficulty: 'easy',
    scenario: 'default',
    trials: [],
    ruleset: { version: 1, fingerprint: 'r1' },
    sprintsPlayed: 3,
    winType: 'happiness',
    finalOrg: { morale: 80, seniorHp: 60 },
    budget: 20,
    boundarySeniorHp: [50, 30, 60],
    ...overrides,
  };
}

describe('RI-292 複数種類の自己ベスト', () => {
  it('指標・ラン種別・難易度・シナリオ・試練・rulesetを分けたキーで記録し、試練の順序は問わない', () => {
    const ruleset = { version: 1, fingerprint: 'r1' };
    const key = altBestKey('seniorHpAtClear', won({ trials: ['b', 'a'] }), ruleset);
    expect(key).toBe(altBestKey('seniorHpAtClear', won({ trials: ['a', 'b'] }), ruleset));
    expect(key).toContain(':default:');
    const others = [
      altBestKey('minSeniorHp', won(), ruleset),
      altBestKey('seniorHpAtClear', won({ runKind: 'daily' }), ruleset),
      altBestKey('seniorHpAtClear', won({ difficulty: 'normal' }), ruleset),
      altBestKey('seniorHpAtClear', won({ scenario: 'copilot' }), ruleset),
      altBestKey('seniorHpAtClear', won({ scenario: 'claude-code' }), ruleset),
      altBestKey('seniorHpAtClear', won({ scenario: 'devin' }), ruleset),
      altBestKey('seniorHpAtClear', won(), ruleset),
      altBestKey('seniorHpAtClear', won(), { version: 2, fingerprint: 'r1' }),
      altBestKey('seniorHpAtClear', won(), { version: 1, fingerprint: 'r2' }),
    ];
    expect(new Set([key, ...others]).size).toBe(10);
    let book = recordAltBest({}, won(), 'seniorHpAtClear').book;
    book = recordAltBest(book, won({ difficulty: 'hard' }), 'seniorHpAtClear').book;
    book = recordAltBest(book, won({ scenario: 'copilot' }), 'seniorHpAtClear').book;
    expect(Object.keys(book)).toHaveLength(3);
  });

  it('敗北・開始直後・ruleset不明の旧保存は記録の対象外にする', () => {
    for (const input of [
      won({ status: 'lost' }),
      won({ status: 'playing' }),
      won({ sprintsPlayed: 0, boundarySeniorHp: [] }),
      won({ ruleset: null }),
    ]) {
      const book = {};
      const result = recordAltBest(book, input, 'seniorHpAtClear');
      expect(result.update).toBe('not-eligible');
      expect(result.book).toBe(book);
    }
  });

  it('欠測・非有限値・境界の不足は0として採用せず、記録を変えない', () => {
    const book = recordAltBest({}, won(), 'minSeniorHp').book;
    for (const [input, metric] of [
      [won({ finalOrg: undefined }), 'moraleAtClear'],
      [won({ finalOrg: { morale: Number.NaN, seniorHp: 60 } }), 'moraleAtClear'],
      [won({ budget: undefined }), 'budgetAtClear'],
      [won({ boundarySeniorHp: undefined }), 'minSeniorHp'],
      [won({ boundarySeniorHp: [50, 30] }), 'minSeniorHp'],
      [won({ boundarySeniorHp: [50, Number.POSITIVE_INFINITY, 60] }), 'minSeniorHp'],
    ] as const) {
      expect(measureAltBest(input, metric)).toBeNull();
      const result = recordAltBest(book, input, metric);
      expect(result.update).toBe('missing');
      expect(result.book).toBe(book);
    }
    expect(measureAltBest(won(), 'minSeniorHp')).toBe(30);
    expect(measureAltBest(won({ budget: 0 }), 'budgetAtClear')).toBe(0);
  });

  it('同値は先の記録を残し、下回る記録は無視し、上回る記録だけ置き換える', () => {
    const first = recordAltBest({}, won({ sprintsPlayed: 3 }), 'seniorHpAtClear');
    expect(first.update).toBe('new');
    const tie = recordAltBest(first.book, won({ sprintsPlayed: 4 }), 'seniorHpAtClear');
    expect(tie.update).toBe('tie');
    expect(tie.book).toBe(first.book);
    const lower = recordAltBest(
      first.book,
      won({ finalOrg: { morale: 80, seniorHp: 59 } }),
      'seniorHpAtClear',
    );
    expect(lower.update).toBe('lower');
    expect(lower.book).toBe(first.book);
    const better = recordAltBest(
      first.book,
      won({ finalOrg: { morale: 80, seniorHp: 61 }, winType: 'healthy' }),
      'seniorHpAtClear',
    );
    expect(better.update).toBe('improved');
    expect(Object.values(better.book)).toEqual([
      { value: 61, sprintsPlayed: 3, winType: 'healthy' },
    ]);
    expect(Object.values(first.book)[0].value).toBe(60);
  });

  it('既存のbestScore・ポイント・デイリー記録を巻き戻さず、別の記録として持つ', () => {
    const reward = { won: true, difficulty: 'easy' as const, score: 500, scoreMul: 1, maxCombo: 0 };
    let meta = applyRunReward(defaultMeta(), reward);
    meta = applyDailyRunReward(meta, { ...reward, dateStr: '2026-10-10' }).meta;
    const before = structuredClone(meta);
    const book = recordAltBest({}, won({ ruleset: { ...CURRENT_RUN_RULESET } }), 'seniorHpAtClear');
    expect(meta).toEqual(before);
    expect(Object.keys(meta)).not.toContain('altBests');
    const later = applyRunReward(meta, { ...reward, score: 100 });
    expect(later.bestScore).toBe(500);
    expect(later.points).toBeGreaterThan(meta.points);
    expect(later.dailyRuns).toEqual(meta.dailyRuns);
    expect(Object.keys(book.book)).toHaveLength(1);
  });

  it('ruleset不明や開始直後の勝利は、値が測れても標本・分布・上限到達・スプリント別平均に入れない', () => {
    const eligible = won({
      finalOrg: { morale: 100, seniorHp: 40 },
      budget: 10,
      boundarySeniorHp: [40, 40, 40],
    });
    const legacy = won({
      ruleset: null,
      sprintsPlayed: 1,
      finalOrg: { morale: 10, seniorHp: 10 },
      budget: 99,
      boundarySeniorHp: [10],
    });
    const unstarted = won({
      sprintsPlayed: 0,
      finalOrg: { morale: 1, seniorHp: 1 },
      budget: 1,
      boundarySeniorHp: [],
    });
    const missing = won({ finalOrg: undefined, budget: undefined, boundarySeniorHp: undefined });
    const rows = evaluateAltBests([legacy, eligible, unstarted, won({ status: 'lost' }), missing]);
    for (const row of rows) {
      expect(row.samples).toBe(1);
      expect(row.updates['not-eligible']).toBe(3);
      expect(row.updates.missing).toBe(1);
      expect(row.distinct).toBe(1);
    }
    expect(rows.find((row) => row.metric === 'moraleAtClear')).toMatchObject({
      min: 100,
      max: 100,
      ceilingHits: 1,
      meanBySprints: { 3: 100 },
    });
    expect(rows.find((row) => row.metric === 'budgetAtClear')!.meanBySprints).toEqual({ 3: 10 });
    expect(rows.find((row) => row.metric === 'minSeniorHp')).toMatchObject({
      min: 40,
      max: 40,
      meanBySprints: { 3: 40 },
    });
  });

  it('現行バランスの勝利20件では士気が全件上限に張り付き、記録が初回から動かない', () => {
    const rows = evaluateAltBests(inputs);
    const row = (metric: string) => rows.find((item) => item.metric === metric)!;
    expect(inputs).toHaveLength(20);
    expect(inputs.every((input) => input.scenario === 'default')).toBe(true);
    expect(row('moraleAtClear')).toMatchObject({
      samples: 20,
      distinct: 1,
      ceilingHits: 20,
      updates: { new: 1, tie: 19, improved: 0 },
    });
    expect(row('seniorHpAtClear')).toMatchObject({ distinct: 20, ceilingHits: 1 });
    expect(row('minSeniorHp')).toMatchObject({ distinct: 20, ceilingHits: 0 });
    expect(row('budgetAtClear').ceilingHits).toBeNull();
  });

  it('予算残と最低シニア余力は短いランほど高く、勝利時のシニア余力は長さに沿って下がらない', () => {
    const rows = evaluateAltBests(inputs);
    const means = (metric: string) => rows.find((item) => item.metric === metric)!.meanBySprints;
    expect(means('budgetAtClear')).toEqual({ 12: 41.2, 18: 35.6, 24: 22, 30: 6.5, 36: 2 });
    expect(means('minSeniorHp')).toEqual({ 12: 17.3, 18: 13.4, 24: 15.8, 30: 9.8, 36: 9.1 });
    expect(means('seniorHpAtClear')).toEqual({ 12: 83.9, 18: 92.3, 24: 84.4, 30: 82.9, 36: 94.1 });
    expect(rows.find((item) => item.metric === 'budgetAtClear')!.bestSprintsPlayed).toEqual([12]);
  });

  it('比較JSONと一致する', () => {
    expect(evaluateAltBests(inputs)).toEqual(JSON.parse(JSON.stringify(comparison.results)));
  });
});
