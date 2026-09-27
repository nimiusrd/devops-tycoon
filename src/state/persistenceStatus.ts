/**
 * 自動保存の状態表示（RI-145）。
 *
 * 保存中・保存済み・保存失敗・このセッション限りを区別する。
 * 読み上げ用の文は失敗・セッション切替・復旧のときだけ変え、連続保存では更新しない。
 * 最後に端末へ書けた時刻はチャネルごとに持ち、失敗の案内はそのチャネルの時刻だけを使う。
 */

export type PersistenceChannel = 'meta' | 'run' | 'replay';
export type PersistenceWrite = 'idle' | 'saving' | 'saved' | 'failed';
export type PersistenceFailure = 'quota' | 'transient';

export interface PersistenceNotice {
  state: 'idle' | 'saving' | 'saved' | 'failed' | 'session';
  tone: 'quiet' | 'warn' | 'danger';
  headline: string;
  detail: string;
  /** 失敗・セッション・復旧だけ。保存中と保存済みの繰り返しでは空のまま。 */
  liveMessage: string;
  showRetry: boolean;
  showExport: boolean;
  /** 常駐バナーにする。保存中・保存済みは盤面を押し下げない。 */
  persistent: boolean;
}

interface ChannelState {
  generation: number;
  write: PersistenceWrite;
  failure: PersistenceFailure | null;
  /** 未保存が残ったまま次の書き込み中。案内は失敗のままにする。 */
  savingWhileFailed: boolean;
}

const CHANNELS: readonly PersistenceChannel[] = ['meta', 'run', 'replay'];

const SESSION_LABEL: Record<PersistenceChannel, string> = {
  meta: 'メタ進行',
  run: '途中セーブ',
  replay: 'リプレイ',
};

function freshChannel(): ChannelState {
  return { generation: 0, write: 'idle', failure: null, savingWhileFailed: false };
}

export function persistenceFailureKind(error: unknown): PersistenceFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota';
  return 'transient';
}

export function formatPersistenceClock(at: number): string {
  const date = new Date(at);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function durableMoment(at: number | null): string {
  if (at === null) return 'まだ端末へ保存できていません。';
  return `最後に端末へ保存できた時刻は ${formatPersistenceClock(at)} です。`;
}

export class PersistenceTracker {
  private readonly channels: Record<PersistenceChannel, ChannelState> = {
    meta: freshChannel(),
    run: freshChannel(),
    replay: freshChannel(),
  };
  private readonly session = new Set<PersistenceChannel>();
  private readonly lastDurableAt: Record<PersistenceChannel, number | null> = {
    meta: null,
    run: null,
    replay: null,
  };
  private liveMessage = '';
  private announcedFailure = false;
  /** 復旧文を出した直後だけ、保存済みチップを見せる。 */
  private showTransientBanner = false;

  markSession(channel: PersistenceChannel): void {
    this.session.add(channel);
    this.syncLiveFromState();
  }

  isSession(channel?: PersistenceChannel): boolean {
    if (channel) return this.session.has(channel);
    return this.session.size > 0;
  }

  isFailed(channel: PersistenceChannel): boolean {
    return this.channels[channel].write === 'failed';
  }

  clearSession(channel: PersistenceChannel): void {
    if (!this.session.delete(channel)) return;
    if (this.session.size === 0 && !this.hasFailure()) {
      // 失敗の復旧を待たずにセッションが終わっても、次の通常保存を復旧扱いしない。
      this.announcedFailure = false;
      this.liveMessage = '保存済みデータを読み直せました。';
      this.showTransientBanner = true;
      return;
    }
    this.syncLiveFromState();
  }

  /**
   * そのチャネルで端末へ書けた時刻を残す。
   * 復旧チップや読み上げは出さない。別チャネルの失敗案内には使わない。
   */
  noteDurableAt(channel: PersistenceChannel, at: number): void {
    if (!Number.isFinite(at)) return;
    const current = this.lastDurableAt[channel];
    if (current !== null && at <= current) return;
    this.lastDurableAt[channel] = at;
  }

  /** 復旧チップを閉じる。読み上げ文は残す。閉じたら true。 */
  dismissTransientBanner(): boolean {
    if (!this.showTransientBanner) return false;
    this.showTransientBanner = false;
    return true;
  }

  /**
   * 世代が遅れても、未保存が尽きた現在の失敗を成功にする。
   * すでに成功・待機中なら false。
   */
  settleCurrent(channel: PersistenceChannel, at: number): boolean {
    const current = this.channels[channel];
    if (current.write !== 'failed' || current.savingWhileFailed) return false;
    return this.succeed(channel, current.generation, at);
  }

  begin(channel: PersistenceChannel): number {
    const current = this.channels[channel];
    current.generation += 1;
    if (current.write === 'failed') current.savingWhileFailed = true;
    else {
      current.write = 'saving';
      current.savingWhileFailed = false;
    }
    return current.generation;
  }

  succeed(channel: PersistenceChannel, generation: number, at: number | null): boolean {
    const current = this.channels[channel];
    // 世代が遅れても、そのチャネルの時刻自体は残す。削除の成功は時刻にしない。
    if (at !== null) this.noteDurableAt(channel, at);
    if (current.generation !== generation) return false;
    const recovered = current.write === 'failed';
    current.write = 'saved';
    current.failure = null;
    current.savingWhileFailed = false;
    const failuresRemain = this.hasFailure();
    const session = this.isSession();
    const announceRecovery = (recovered || this.announcedFailure) && !failuresRemain && !session;
    // 失敗が尽きたら世代を消す。セッションが残っていても、次の通常保存を復旧扱いしない。
    if (!failuresRemain) this.announcedFailure = false;
    if (announceRecovery) {
      this.liveMessage = '保存できました。';
      this.showTransientBanner = true;
    } else if (failuresRemain || session) {
      this.syncLiveFromState();
    }
    return true;
  }

  fail(
    channel: PersistenceChannel,
    generation: number,
    error: unknown,
    preserveFailure = false,
  ): boolean {
    const current = this.channels[channel];
    if (current.generation !== generation) return false;
    current.write = 'failed';
    const next = persistenceFailureKind(error);
    current.failure = preserveFailure && current.failure ? current.failure : next;
    current.savingWhileFailed = false;
    this.announcedFailure = true;
    this.syncLiveFromState();
    return true;
  }

  notice(canExportRun: boolean): PersistenceNotice {
    const session = this.isSession();
    const failure = this.currentFailure();
    const saving = CHANNELS.some((channel) => this.channels[channel].write === 'saving');
    const newest = this.newestDurableAt();
    const saved = newest !== null;
    const moment = failure ? this.failedChannelMoment() : durableMoment(newest);

    if (session) {
      return {
        state: 'session',
        tone: 'warn',
        headline: 'このセッション限り',
        detail: failure
          ? `${this.sessionCopy()}${this.failureDetail(failure, moment)}`
          : this.sessionCopy(),
        liveMessage: this.liveMessage,
        showRetry: true,
        showExport: canExportRun,
        persistent: true,
      };
    }
    if (failure) {
      return {
        state: 'failed',
        tone: 'danger',
        headline: '保存失敗',
        detail: `${this.failureDetail(failure, moment)}進行はメモリに残しています。`,
        liveMessage: this.liveMessage,
        showRetry: true,
        showExport: canExportRun,
        persistent: true,
      };
    }
    if (saving) {
      return {
        state: 'saving',
        tone: 'quiet',
        headline: '保存中',
        detail: '端末への書き込みを待っています。',
        liveMessage: this.liveMessage,
        showRetry: false,
        showExport: false,
        persistent: false,
      };
    }
    if (this.showTransientBanner && this.liveMessage === '保存済みデータを読み直せました。') {
      return {
        state: 'saved',
        tone: 'quiet',
        headline: '保存済み',
        detail: '保存済みデータを読み直せました。',
        liveMessage: this.liveMessage,
        showRetry: false,
        showExport: false,
        persistent: false,
      };
    }
    if (saved && (this.liveMessage === '' || this.showTransientBanner)) {
      return {
        state: 'saved',
        tone: 'quiet',
        headline: '保存済み',
        detail: moment,
        liveMessage: this.liveMessage,
        showRetry: false,
        showExport: false,
        persistent: false,
      };
    }
    return {
      state: 'idle',
      tone: 'quiet',
      headline: '',
      detail: '',
      liveMessage: this.liveMessage,
      showRetry: false,
      showExport: false,
      persistent: false,
    };
  }

  private newestDurableAt(): number | null {
    let newest: number | null = null;
    for (const channel of CHANNELS) {
      const at = this.lastDurableAt[channel];
      if (at === null) continue;
      if (newest === null || at > newest) newest = at;
    }
    return newest;
  }

  /** 失敗中のチャネルだけを見る。未保存のチャネルがあれば、ほかの成功時刻は出さない。 */
  private failedChannelMoment(): string {
    let earliest: number | null = null;
    for (const channel of CHANNELS) {
      if (this.channels[channel].write !== 'failed') continue;
      const at = this.lastDurableAt[channel];
      if (at === null) return durableMoment(null);
      if (earliest === null || at < earliest) earliest = at;
    }
    return durableMoment(earliest);
  }

  private hasFailure(): boolean {
    return this.currentFailure() !== null;
  }

  private currentFailure(): PersistenceFailure | null {
    let failure: PersistenceFailure | null = null;
    for (const channel of CHANNELS) {
      const current = this.channels[channel];
      if (current.write !== 'failed' || !current.failure) continue;
      if (current.failure === 'quota') return 'quota';
      failure = 'transient';
    }
    return failure;
  }

  private failureDetail(failure: PersistenceFailure, moment: string): string {
    if (failure === 'quota') return `容量が不足しています。${moment}`;
    return `保存できませんでした。${moment}`;
  }

  private failureLive(failure: PersistenceFailure): string {
    if (failure === 'quota') return '容量が不足して保存できません。再試行できます。';
    return '保存に失敗しました。再試行できます。';
  }

  /** セッション対象と、残っている失敗のうち重い方を読み上げる。 */
  private syncLiveFromState(): void {
    const failure = this.currentFailure();
    if (this.isSession()) {
      const scope = this.sessionCopy();
      this.liveMessage = failure ? `${scope}${this.failureLive(failure)}` : scope;
      return;
    }
    if (failure) this.liveMessage = this.failureLive(failure);
  }

  private sessionCopy(): string {
    const labels = CHANNELS.filter((channel) => this.session.has(channel)).map(
      (channel) => SESSION_LABEL[channel],
    );
    const subject = labels.join('・');
    if (labels.length === CHANNELS.length) {
      return `起動時に${subject}を読めなかったため、これらはこのセッション限りです。再試行は保存済みデータの再読込です。`;
    }
    return `起動時に${subject}を読めなかったため、${subject}はこのセッション限りです。ほかの保存は端末へ続きます。再試行は保存済みデータの再読込です。`;
  }
}
