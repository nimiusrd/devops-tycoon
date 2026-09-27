import { describe, expect, it } from 'vitest';
import {
  formatPersistenceClock,
  PersistenceTracker,
  persistenceFailureKind,
} from '../../../src/state/persistenceStatus';

describe('PersistenceTracker', () => {
  it('連続した保存成功では読み上げ文を変えない', () => {
    const tracker = new PersistenceTracker();
    const first = tracker.begin('meta');
    expect(tracker.notice(false)).toMatchObject({ state: 'saving', liveMessage: '' });
    tracker.succeed('meta', first, 1_700_000_000_000);
    const saved = tracker.notice(false);
    expect(saved.state).toBe('saved');
    expect(saved.detail).toContain(formatPersistenceClock(1_700_000_000_000));
    expect(saved.liveMessage).toBe('');
    expect(saved.persistent).toBe(false);

    const second = tracker.begin('run');
    tracker.succeed('run', second, 1_700_000_060_000);
    expect(tracker.notice(false).liveMessage).toBe('');
    expect(tracker.notice(false).detail).toContain(formatPersistenceClock(1_700_000_060_000));
  });

  it('容量不足と一過性失敗を区別し、復旧時に一度だけ読み上げを変える', () => {
    const tracker = new PersistenceTracker();
    const quota = new DOMException('full', 'QuotaExceededError');
    expect(persistenceFailureKind(quota)).toBe('quota');
    expect(persistenceFailureKind(new Error('offline'))).toBe('transient');

    const generation = tracker.begin('run');
    tracker.fail('run', generation, quota);
    const failed = tracker.notice(true);
    expect(failed).toMatchObject({
      state: 'failed',
      persistent: true,
      showRetry: true,
      showExport: true,
    });
    expect(failed.detail).toContain('容量が不足');
    expect(failed.detail).toContain('まだ端末へ保存できていません');
    expect(failed.liveMessage).toContain('容量');

    const again = tracker.begin('run');
    tracker.fail('run', again, quota);
    expect(tracker.notice(true).liveMessage).toBe(failed.liveMessage);

    const retry = tracker.begin('run');
    tracker.succeed('run', retry, 1_700_000_000_000);
    const recovered = tracker.notice(false);
    expect(recovered.state).toBe('saved');
    expect(recovered.liveMessage).toBe('保存できました。');
    expect(recovered.persistent).toBe(false);

    const later = tracker.begin('meta');
    tracker.succeed('meta', later, 1_700_000_120_000);
    expect(tracker.notice(false).liveMessage).toBe('保存できました。');
  });

  it('古い世代の完了では新しい失敗を消さない', () => {
    const tracker = new PersistenceTracker();
    const older = tracker.begin('meta');
    const newer = tracker.begin('meta');
    tracker.fail('meta', newer, new Error('transient'));
    expect(tracker.succeed('meta', older, 10)).toBe(false);
    expect(tracker.notice(false).state).toBe('failed');
  });

  it('セッション限りは再読込案内を常駐し、復旧文は一度だけ変える', () => {
    const tracker = new PersistenceTracker();
    tracker.markSession('meta');
    tracker.markSession('run');
    const session = tracker.notice(false);
    expect(session.state).toBe('session');
    expect(session.persistent).toBe(true);
    expect(session.showRetry).toBe(true);
    expect(session.detail).toContain('メタ進行・途中セーブ');
    expect(session.detail).toContain('ほかの保存は端末へ続きます');
    expect(session.detail).not.toContain('リプレイ');
    expect(session.liveMessage).toContain('メタ進行・途中セーブ');

    tracker.clearSession('meta');
    const remaining = tracker.notice(false);
    expect(remaining.state).toBe('session');
    expect(remaining.detail).toContain('途中セーブはこのセッション限り');
    expect(remaining.detail).not.toContain('メタ進行');
    expect(remaining.liveMessage).toContain('途中セーブ');
    expect(remaining.liveMessage).not.toContain('読み直せました');

    tracker.clearSession('run');
    expect(tracker.notice(false)).toMatchObject({
      state: 'saved',
      liveMessage: '保存済みデータを読み直せました。',
      persistent: false,
    });
    expect(tracker.dismissTransientBanner()).toBe(true);
    expect(tracker.notice(false).state).toBe('idle');
    expect(tracker.notice(false).liveMessage).toContain('読み直せました');
    expect(tracker.dismissTransientBanner()).toBe(false);
  });

  it('読込済みの保存時刻は失敗詳細に残り、復旧チップは出さない', () => {
    const tracker = new PersistenceTracker();
    const savedAt = 1_700_000_000_000;
    tracker.noteDurableAt(savedAt);
    const noted = tracker.notice(true);
    expect(noted.liveMessage).toBe('');
    expect(noted.persistent).toBe(false);
    expect(noted.detail).toContain(formatPersistenceClock(savedAt));

    const generation = tracker.begin('run');
    tracker.fail('run', generation, new Error('transient'));
    const failed = tracker.notice(true);
    expect(failed.detail).toContain('最後に端末へ保存できた時刻');
    expect(failed.detail).toContain(formatPersistenceClock(savedAt));
    expect(failed.detail).not.toContain('まだ端末へ保存できていません');
    expect(failed.liveMessage).toContain('失敗');
  });

  it('遅れた世代でも未保存が尽きた失敗は成功にする', () => {
    const tracker = new PersistenceTracker();
    const older = tracker.begin('replay');
    const newer = tracker.begin('replay');
    tracker.fail('replay', newer, new Error('still pending'));
    expect(tracker.succeed('replay', older, 20)).toBe(false);
    expect(tracker.notice(false).state).toBe('failed');
    expect(tracker.settleCurrent('replay', 30)).toBe(true);
    expect(tracker.notice(false).state).toBe('saved');
    expect(tracker.notice(false).liveMessage).toBe('保存できました。');
  });

  it('複数チャネルの失敗では、読み上げも容量不足を優先する', () => {
    const tracker = new PersistenceTracker();
    const quota = tracker.begin('run');
    tracker.fail('run', quota, new DOMException('full', 'QuotaExceededError'));
    const transient = tracker.begin('meta');
    tracker.fail('meta', transient, new Error('offline'));

    const failed = tracker.notice(true);
    expect(failed.detail).toContain('容量が不足');
    expect(failed.liveMessage).toContain('容量');
    expect(failed.liveMessage).not.toContain('保存に失敗しました');

    const recoveredQuota = tracker.begin('run');
    tracker.succeed('run', recoveredQuota, 1_700_000_000_000);
    const remaining = tracker.notice(true);
    expect(remaining.state).toBe('failed');
    expect(remaining.detail).toContain('保存できませんでした');
    expect(remaining.detail).not.toContain('容量が不足');
    expect(remaining.liveMessage).toContain('保存に失敗しました');
  });

  it('失敗中の次の書き込みでも、失敗案内と再試行を残す', () => {
    const tracker = new PersistenceTracker();
    const failed = tracker.begin('replay');
    tracker.fail('replay', failed, new Error('storage unavailable'));
    const next = tracker.begin('replay');
    const during = tracker.notice(true);
    expect(during.state).toBe('failed');
    expect(during.showRetry).toBe(true);
    expect(during.showExport).toBe(true);
    expect(tracker.settleCurrent('replay', 10)).toBe(false);

    tracker.succeed('replay', next, 20);
    expect(tracker.notice(false).state).toBe('saved');
    expect(tracker.notice(false).liveMessage).toBe('保存できました。');
  });

  it('一部のチャネルだけがセッション限りだと、対象を案内する', () => {
    const tracker = new PersistenceTracker();
    tracker.markSession('replay');
    const session = tracker.notice(false);
    expect(session.detail).toContain('リプレイはこのセッション限り');
    expect(session.detail).toContain('ほかの保存は端末へ続きます');
    expect(session.liveMessage).toContain('リプレイはこのセッション限り');

    tracker.markSession('meta');
    tracker.markSession('run');
    const all = tracker.notice(false);
    expect(all.detail).toContain('メタ進行・途中セーブ・リプレイ');
    expect(all.detail).toContain('これらはこのセッション限り');
    expect(all.detail).not.toContain('ほかの保存は端末へ続きます');
  });
});
