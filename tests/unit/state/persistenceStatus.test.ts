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
    expect(session.detail).toContain('書き戻しません');
    expect(session.liveMessage).toContain('このセッション限り');

    tracker.clearSession('meta');
    expect(tracker.notice(false).state).toBe('session');
    expect(tracker.notice(false).liveMessage).toBe(session.liveMessage);

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
});
