import { describe, expect, it } from 'vitest';
import { advance } from '../../tests/unit/helpers/runFlow';
import { getCard } from '../data/cards';
import { getRelic } from '../data/relics';
import { RunEngine } from '../sim/run/engine';
import { MAX_PREFERRED_CARDS, defaultMeta } from '../state/meta';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
  type ReplayKeyframe,
} from '../state/replay';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';
import {
  addBuildHistory,
  BUILD_HISTORY_MAX,
  detachRemovedReplays,
  NOT_CARRIED,
  resolveContentStatus,
  sanitizeBuildName,
  startFromBuild,
  summarizeBuild,
  type BuildHistoryEntry,
} from './buildHistory';

function finishedReplay(seed: string, finishedAt = 1000): ReplayBlob {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed);
  const keyframes: ReplayKeyframe[] = [];
  const push = () => {
    const frame = engine.exportReplayFrame();
    if (!frame) return;
    const entry = { phase: frame.phase, frame: structuredClone(frame) };
    if (keyframes[keyframes.length - 1]?.phase === entry.phase)
      keyframes[keyframes.length - 1] = entry;
    else keyframes.push(entry);
  };
  push();
  for (let guard = 0; engine.snapshot().status === 'playing' && guard < 40_000; guard += 1) {
    if (!advance(engine, { unlockEvolution: true })) break;
    push();
  }
  const s = engine.snapshot();
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: `${seed}-${finishedAt}`,
    seed,
    difficulty: s.difficulty,
    trials: [...s.trials],
    finishedAt,
    outcome: {
      status: s.status as 'won' | 'lost',
      winType: s.winType,
      loseReason: s.loseReason,
      diagnosis: s.diagnosis,
      score: s.totals.delivered,
    },
    keyframes,
    ruleset: { ...CURRENT_RUN_RULESET },
    contentSnapshot: snapshotReplayContent(keyframes),
  };
}

const replay = finishedReplay('g1');
const terminal = replay.keyframes[replay.keyframes.length - 1].frame;

function history(count: number): BuildHistoryEntry[] {
  let list: BuildHistoryEntry[] = [];
  for (let index = 0; index < count; index += 1)
    list = addBuildHistory(
      list,
      { ...replay, id: `r${index}`, finishedAt: index },
      `会社${index}`,
    )!;
  return list;
}

describe('RI-293 会社ビルドの履歴帳', () => {
  it('カード・レリック・進化・編成は終端フレームの実状態と一致し、メタの所持に置き換えない', () => {
    const summary = summarizeBuild(replay)!;
    expect(replay.keyframes[replay.keyframes.length - 1].phase).toBe(replay.outcome.status);
    expect(summary.cards.reduce((sum, card) => sum + card.count, 0)).toBe(terminal.deck.length);
    for (const card of summary.cards) {
      const copies = terminal.deck.filter((item) => item.defId === card.defId);
      expect(card.count).toBe(copies.length);
      expect(card.maxLevel).toBe(Math.max(...copies.map((item) => item.level)));
    }
    expect(summary.relics.map((relic) => relic.id)).toEqual([...new Set(terminal.relics)].sort());
    expect(summary.evolution.map((node) => node.id)).toEqual(
      Object.keys(terminal.evolution.unlocked).sort(),
    );
    expect(summary.evolution.length).toBeGreaterThan(0);
    expect(summary.roster.map((member) => member.name)).toEqual(
      terminal.roster.members.map((member) => member.name),
    );
    expect(defaultMeta().unlockedCards).toEqual([]);
    expect(summary.cards.length).toBeGreaterThan(0);
  });

  it('記録時の定義と比べて、変更されたカード・廃止されたカードや進化を識別する', () => {
    const changed = structuredClone(replay);
    const end = changed.keyframes[changed.keyframes.length - 1].frame;
    const kept = end.deck[0].defId;
    const renamedId = end.deck.find((card) => card.defId !== kept)!.defId;
    end.deck.push({ defId: 'retired-card', level: 2 });
    end.evolution.unlocked['retired-node'] = true;
    if (!end.relics.includes('psych-safety')) end.relics.push('psych-safety');
    const snapshot = changed.contentSnapshot!;
    snapshot.cards = snapshot.cards.map((def) => {
      if (def.id === kept) return { ...def, cost: def.cost + 1 };
      if (def.id === renamedId) return { ...def, name: `${def.name}（旧）` };
      return def;
    });
    snapshot.cards.push({ ...getCard(kept)!, id: 'retired-card', name: '旧施策' });
    snapshot.relics = snapshot.relics.filter((relic) => relic.id !== 'psych-safety');
    snapshot.relics.push({ ...getRelic('psych-safety')!, name: '旧レリック' });
    const summary = resolveContentStatus(summarizeBuild(changed)!);
    const card = (id: string) => summary.cards.find((item) => item.defId === id)!;
    expect(card(kept).status).toBe('changed');
    expect(card(renamedId)).toMatchObject({
      name: expect.stringMatching(/（旧）$/),
      status: 'changed',
    });
    expect(card('retired-card')).toMatchObject({ name: '旧施策', status: 'retired', maxLevel: 2 });
    expect(summary.relics.find((relic) => relic.id === 'psych-safety')).toMatchObject({
      name: '旧レリック',
      status: 'changed',
    });
    expect(summary.evolution.find((node) => node.id === 'retired-node')!.status).toBe('retired');
    expect(
      resolveContentStatus(summarizeBuild(replay)!).cards.every(
        (item) => item.status === 'current',
      ),
    ).toBe(true);
    expect(summary.ruleset).toEqual(CURRENT_RUN_RULESET);
  });

  it('記録時スナップショットが無いカードやレリックは、現行にあっても current にしない', () => {
    const legacy = structuredClone(replay);
    legacy.contentSnapshot = null;
    const end = legacy.keyframes[legacy.keyframes.length - 1].frame;
    end.deck.push({ defId: 'retired-card', level: 1 });
    if (!end.relics.includes('psych-safety')) end.relics.push('psych-safety');
    const summary = resolveContentStatus(summarizeBuild(legacy)!);
    const known = summary.cards.filter((card) => card.defId !== 'retired-card');
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((card) => card.status === 'unknown' && card.recorded === null)).toBe(true);
    expect(summary.cards.find((card) => card.defId === 'retired-card')!.status).toBe('retired');
    expect(summary.relics.find((relic) => relic.id === 'psych-safety')).toMatchObject({
      status: 'unknown',
      recorded: null,
    });
  });

  it('開始は既存の開始レシピへ変換できる範囲だけで、構成は引き継がない', () => {
    const entry = addBuildHistory([], replay, '燃え尽き会社')![0];
    const started = startFromBuild(entry, defaultMeta());
    expect(started).toEqual({
      ok: true,
      recipe: {
        seed: 'g1',
        difficulty: 'normal',
        trials: [],
        scenario: replay.keyframes[0].frame.scenario,
        preferredCardIds: [],
      },
      notCarried: NOT_CARRIED,
    });
    expect(NOT_CARRIED).toEqual(['deck', 'cardLevels', 'relics', 'evolution', 'roster', 'budget']);
    const other = { version: CURRENT_RUN_RULESET.version + 1, fingerprint: 'next' };
    expect(startFromBuild(entry, defaultMeta(), other)).toMatchObject({
      ok: false,
      reason: 'ruleset-mismatch',
    });
    const legacy = { ...entry, summary: { ...entry.summary, ruleset: null } };
    expect(startFromBuild(legacy, defaultMeta())).toMatchObject({ reason: 'ruleset-unknown' });
    const noStart = { ...entry, summary: { ...entry.summary, start: null } };
    expect(startFromBuild(noStart, defaultMeta())).toMatchObject({ reason: 'no-start-frame' });
    const hard = {
      ...entry,
      summary: {
        ...entry.summary,
        start: { ...entry.summary.start!, difficulty: 'hard' as const },
      },
    };
    expect(startFromBuild(hard, defaultMeta())).toMatchObject({ reason: 'locked' });
    const invalid = (
      start: Partial<NonNullable<typeof entry.summary.start>>,
    ): ReturnType<typeof startFromBuild> =>
      startFromBuild(
        {
          ...entry,
          summary: { ...entry.summary, start: { ...entry.summary.start!, ...start } },
        },
        defaultMeta(),
      );
    expect(invalid({ scenario: 'missing-scenario' })).toMatchObject({ reason: 'invalid-start' });
    expect(invalid({ trials: ['low-focus', 'low-focus'] })).toMatchObject({
      reason: 'invalid-start',
    });
    expect(invalid({ preferredCardIds: ['copilot', 'copilot'] })).toMatchObject({
      reason: 'invalid-start',
    });
    expect(
      invalid({
        preferredCardIds: Array.from({ length: MAX_PREFERRED_CARDS + 1 }, () => 'docs'),
      }),
    ).toMatchObject({ reason: 'invalid-start' });
  });

  it('名前を整え、同じリプレイは名前だけ更新し、終端のない記録は残さない', () => {
    const summary = summarizeBuild(replay)!;
    expect(sanitizeBuildName('  レビュー   重視  ', summary)).toBe('レビュー 重視');
    expect([...sanitizeBuildName('あ'.repeat(40), summary)]).toHaveLength(24);
    expect(sanitizeBuildName('   ', summary)).toBe(`g1 / ${summary.outcome.winType ?? 'lost'}`);
    const first = addBuildHistory([], replay, '一回目')!;
    const renamed = addBuildHistory(first, replay, '二回目')!;
    expect(renamed).toHaveLength(1);
    expect(renamed[0].name).toBe('二回目');
    expect(first[0].name).toBe('一回目');
    const unfinished = { ...replay, keyframes: replay.keyframes.slice(0, -1) };
    expect(addBuildHistory(first, unfinished, 'x')).toBeNull();
    const continued = structuredClone(replay);
    const earlier = continued.keyframes.find(
      (keyframe) => keyframe.phase !== 'won' && keyframe.phase !== 'lost',
    )!;
    continued.keyframes.push(structuredClone(earlier));
    expect(summarizeBuild(continued)).toBeNull();
    const detached = detachRemovedReplays(first, new Set());
    const reimported = addBuildHistory(detached, replay, '再取り込み')!;
    expect(reimported).toHaveLength(1);
    expect(reimported[0].id).toBe(first[0].id);
    expect(reimported[0].name).toBe('再取り込み');
    expect(reimported[0].sourceReplayId).toBeNull();
    expect(reimported[0].summary).toEqual(detached[0].summary);
  });

  it('履歴はリプレイ10件上限と別に20件まで残し、消えた元記録への参照だけを外す', () => {
    const full = history(BUILD_HISTORY_MAX + 3);
    expect(full).toHaveLength(BUILD_HISTORY_MAX);
    expect(full[0].sourceReplayId).toBe('r22');
    expect(full[full.length - 1].sourceReplayId).toBe('r3');
    const kept = new Set(full.slice(0, 10).map((entry) => entry.sourceReplayId!));
    const before = structuredClone(full);
    const detached = detachRemovedReplays(full, kept);
    expect(full).toEqual(before);
    expect(detached.filter((entry) => entry.sourceReplayId !== null)).toHaveLength(10);
    expect(detached.slice(10).every((entry) => entry.sourceReplayId === null)).toBe(true);
    expect(detached.map((entry) => entry.summary)).toEqual(full.map((entry) => entry.summary));
  });

  it('保存した要約は元のリプレイを後から変えても変わらない', () => {
    const source = structuredClone(replay);
    const [entry] = addBuildHistory([], source, '固定')!;
    const snapshot = structuredClone(entry);
    source.keyframes[source.keyframes.length - 1].frame.deck.push({ defId: 'x', level: 1 });
    source.trials.push('budget_cut');
    expect(entry).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  it('定義差分は保存せず、残した記録時定義と現行定義から閲覧のたびに決める', () => {
    const [entry] = addBuildHistory([], replay, '固定判定')!;
    expect(entry.summary.cards.every((card) => card.recorded && !('status' in card))).toBe(true);
    const detached = detachRemovedReplays([entry], new Set());
    expect(detached[0].summary.cards[0].recorded).toEqual(entry.summary.cards[0].recorded);
    expect(
      resolveContentStatus(detached[0].summary).cards.every((card) => card.status === 'current'),
    ).toBe(true);
    const recorded = detached[0].summary.cards[0].recorded!;
    const renamed = {
      ...detached[0].summary,
      cards: detached[0].summary.cards.map((card, index) =>
        index === 0
          ? { ...card, recorded: { ...recorded, name: `${recorded.name}（改名）` } }
          : card,
      ),
    };
    const again = resolveContentStatus(renamed);
    expect(again.cards[0].status).toBe('changed');
    expect(again.cards.slice(1).every((card) => card.status === 'current')).toBe(true);
  });
});
