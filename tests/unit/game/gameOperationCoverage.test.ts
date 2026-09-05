import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, installGame, type GameHandle } from '../../../src/game';
import { RECRUIT_COST } from '../../../src/sim/member';
import { defaultMeta, TUTORIAL_CONTENT_VERSION, type MetaState } from '../../../src/state/meta';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import { MemoryRunStorage } from '../../../src/state/runPersistence';
import { playUntil } from '../helpers/runFlow';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function metaStorage() {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async (_meta: MetaState) => undefined),
  };
}

describe('ゲームのメタ操作と永続化の境界', () => {
  it.each<{
    name: string;
    update: (game: GameHandle) => void;
    expected: Partial<MetaState>;
  }>([
    {
      name: 'ミュート設定',
      update: (game) => game.setSoundMuted(false),
      expected: { soundMuted: false },
    },
    {
      name: '研修方針',
      update: (game) => game.setPreferredCardIds(['docs']),
      expected: { preferredCardIds: ['docs'] },
    },
    {
      name: 'ガイドの既読',
      update: (game) => game.markTutorialSeen(),
      expected: { seenTutorial: true, seenTutorialVersion: TUTORIAL_CONTENT_VERSION },
    },
  ])('$name は復元接続前に更新せず、接続後は同じ変更を一度だけ保存する', ({ update, expected }) => {
    const storage = metaStorage();
    const game = createGame({ seed: 'meta-operation', metaReady: false, metaStorage: storage });
    const initial = structuredClone(game.getMeta());
    const revision = game.revision();

    update(game);

    expect(game.getMeta()).toEqual(initial);
    expect(game.revision()).toBe(revision);
    expect(storage.save).not.toHaveBeenCalled();

    const restored = { ...defaultMeta(), points: 73 };
    game.attachMetaPersistence(restored, storage);
    const connectedRevision = game.revision();
    update(game);

    expect(game.getMeta()).toMatchObject({ ...expected, points: 73 });
    expect(storage.save).toHaveBeenCalledExactlyOnceWith(game.getMeta());
    expect(game.revision()).toBe(connectedRevision + 1);
    const updated = structuredClone(game.getMeta());

    update(game);

    expect(game.getMeta()).toEqual(updated);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(game.revision()).toBe(connectedRevision + 1);
  });

  it.each([
    { unlockId: 'missing-unlock', reason: 'unknown', meta: defaultMeta() },
    { unlockId: 'unlock-claude-code', reason: 'insufficient_points', meta: defaultMeta() },
    { unlockId: 'unlock-devin', reason: 'requires', meta: { ...defaultMeta(), points: 100 } },
    {
      unlockId: 'unlock-claude-code',
      reason: 'already_owned',
      meta: { ...defaultMeta(), points: 100, unlockedCards: ['claude-code'] },
    },
  ])(
    '解放購入が $reason で拒否されたらポイント・保存・版番号を変えない',
    ({ unlockId, reason, meta }) => {
      const storage = metaStorage();
      const game = createGame({ seed: 'rejected-unlock', initialMeta: meta, metaStorage: storage });
      const before = structuredClone(game.getMeta());
      const revision = game.revision();

      expect(game.purchaseMetaUnlock(unlockId)).toEqual({ ok: false, reason });

      expect(game.getMeta()).toEqual(before);
      expect(game.revision()).toBe(revision);
      expect(storage.save).not.toHaveBeenCalled();
    },
  );

  it('未解放・重複・上限超過の研修方針を正規化して同値なら再保存しない', () => {
    const storage = metaStorage();
    const game = createGame({
      seed: 'preferred-noop',
      initialMeta: { ...defaultMeta(), preferredCardIds: ['docs', 'copilot'] },
      metaStorage: storage,
    });
    const revision = game.revision();

    game.setPreferredCardIds(['devin', 'docs', 'docs', 'copilot', 'auto-test']);

    expect(game.getMeta().preferredCardIds).toEqual(['docs', 'copilot']);
    expect(game.revision()).toBe(revision);
    expect(storage.save).not.toHaveBeenCalled();
  });
});

describe('ゲームの通常操作とセーブ', () => {
  it('進化解放は離脱時まで保存を待ち、解放済みノードを再度消費しない', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'mulligan-whatif', runStorage: storage });
    game.startRun('easy');
    const evolution = playUntil(game.engine, 'evolution');
    expect(evolution.phase).toBe('evolution');
    expect(evolution.evolution.points).toBeGreaterThan(0);
    // このフェーズを公開操作で保存し、以後のローカル操作による保存差分を観測する。
    game.step(0);
    const saved = await storage.load();
    const save = vi.spyOn(storage, 'save');
    const revision = game.revision();

    const unlocked = game.unlockEvolution('review-1');

    expect(unlocked.phase).toBe('evolution');
    expect(unlocked.evolution.unlocked['review-1']).toBe(true);
    expect(unlocked.evolution.points).toBeLessThan(evolution.evolution.points);
    expect(game.revision()).toBe(revision + 1);
    expect(save).not.toHaveBeenCalled();
    expect(await storage.load()).toEqual(saved);
    expect(game.unlockEvolution('review-1').evolution).toEqual(unlocked.evolution);

    expect(game.finishEvolution().phase).toBe('beat');
    expect(save).toHaveBeenCalledOnce();
    expect((await storage.load())?.state.evolution).toEqual(unlocked.evolution);
  });

  it.each(['recruit', 'relic'] as const)(
    'ショップの %s 購入を一度だけ反映し、退出時に保存する',
    async (purchase) => {
      const storage = new MemoryRunStorage();
      const game = createGame({ seed: 'game-operation-43', runStorage: storage });
      game.startRun('easy');
      expect(playUntil(game.engine, 'beat').beat?.eventId).toBe('shop-offer');
      const shop = game.resolveBeat(0);
      expect(shop.phase).toBe('shop');
      const saved = await storage.load();
      const save = vi.spyOn(storage, 'save');
      const revision = game.revision();

      const purchased = purchase === 'recruit' ? game.buyShopRecruit() : game.buyShopRelic();

      expect(purchased.phase).toBe('shop');
      expect(purchased.status).toBe('playing');
      if (purchase === 'recruit') {
        expect(purchased.budget).toBe(shop.budget - RECRUIT_COST);
        expect(purchased.roster.members).toHaveLength(shop.roster.members.length + 1);
        expect(purchased.roster.members.at(-1)?.assignment).toBe('bench');
        expect(purchased.shop?.recruit?.bought).toBe(true);
        expect(game.buyShopRecruit()).toEqual(purchased);
      } else {
        const offer = shop.shop?.relic;
        expect(offer).toBeDefined();
        expect(purchased.budget).toBe(shop.budget - offer!.cost);
        expect(purchased.relics).toEqual([...shop.relics, offer!.id]);
        expect(purchased.shop?.relic?.bought).toBe(true);
        expect(game.buyShopRelic()).toEqual(purchased);
      }
      expect(game.revision()).toBe(revision + 2);
      expect(save).not.toHaveBeenCalled();
      expect(await storage.load()).toEqual(saved);

      expect(game.leaveShop().phase).toBe('setup');

      expect(save).toHaveBeenCalledOnce();
      expect((await storage.load())?.state).toMatchObject({
        budget: purchased.budget,
        roster: purchased.roster,
        relics: purchased.relics,
      });
    },
  );

  it.each(['hire', 'skip'] as const)(
    '採用面接で %s を選ぶと結果を保存して編成へ戻る',
    async (choice) => {
      const storage = new MemoryRunStorage();
      const game = createGame({ seed: 'game-operation-8', runStorage: storage });
      game.startRun('easy');
      expect(playUntil(game.engine, 'beat').beat?.eventId).toBe('recruit-offer');
      const recruit = game.resolveBeat(0);
      expect(recruit.phase).toBe('recruit');
      const save = vi.spyOn(storage, 'save');

      const setup = game.recruitChoose(choice);

      expect(setup.phase).toBe('setup');
      expect(setup.status).toBe('playing');
      if (choice === 'hire') {
        expect(setup.roster.members).toHaveLength(recruit.roster.members.length + 1);
        expect(setup.roster.members.at(-1)?.assignment).toBe('bench');
        expect(setup.budget).toBe(recruit.budget - RECRUIT_COST);
      } else {
        expect(setup.roster).toEqual(recruit.roster);
        expect(setup.budget).toBe(recruit.budget);
        expect(setup.org.morale).toBeLessThan(recruit.org.morale);
      }
      expect(save).toHaveBeenCalledOnce();
      expect((await storage.load())?.state).toMatchObject({
        phase: 'setup',
        roster: setup.roster,
        budget: setup.budget,
        org: setup.org,
      });
    },
  );
});

describe('ゲーム公開とリプレイ入力', () => {
  it('ブラウザへ公開したハンドルから指定した開始条件で操作できる', () => {
    const browserWindow: { game?: GameHandle } = {};
    vi.stubGlobal('window', browserWindow);

    const game = installGame({ seed: 'installed-game', difficulty: 'easy', trials: [] });

    expect(browserWindow.game).toBe(game);
    expect(browserWindow.game?.startRun()).toMatchObject({
      seed: 'installed-game',
      difficulty: 'easy',
      phase: 'setup',
    });
    expect(game.getRunEpoch()).toBe(1);
  });

  it('window がない環境でもゲームを生成できる', () => {
    vi.stubGlobal('window', undefined);

    const game = installGame({ seed: 'headless-game' });

    expect(game.getState()).toMatchObject({ seed: 'headless-game', phase: 'title' });
    expect(game.startRun('easy').phase).toBe('setup');
  });

  it('不正なデバッグ用リプレイ入力を保存前に拒否する', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'invalid-replay-input' });
    game.startRun('easy');
    await game.attachReplay(storage);
    const save = vi.spyOn(storage, 'save');
    const state = game.engine.snapshot();
    const revision = game.revision();

    expect(await game.importReplay({ schemaVersion: -1, keyframes: [] })).toBe(false);

    expect(save).not.toHaveBeenCalled();
    expect(await storage.list()).toEqual([]);
    expect(game.engine.snapshot()).toEqual(state);
    expect(game.revision()).toBe(revision);
    expect(game.isReplayMode()).toBe(false);
  });
});
