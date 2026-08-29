/**
 * スプリントリザルトの「なぜ燃えたか」解説ログ（RI-34′）。
 *
 * `SprintResult.fireEvents` を読むだけの純関数。描画・状態は知らない（第22.2）。
 */
import { formatSpreadImpact } from './sprintEventView';
import type { FireSprintEvent, SprintResult } from '../sim/types';

export interface BurnCauseEntry {
  /** 安定キー。 */
  key: string;
  /** チェーン先頭の tick。 */
  tick: number;
  /** 先頭アイコン。 */
  icon: string;
  /** 因果チェーン本文。 */
  text: string;
  /** 見た目のトーン。 */
  tone: 'warn' | 'bad' | 'good';
}

export interface BurnCauseLogView {
  /** 炎上が無いときはセクションを省略する。 */
  showSection: boolean;
  /** 件数サマリ（点火 / 鎮火 / 自動鎮火 / 延焼）。 */
  headline: string;
  /** 時系列の因果エントリ（上限あり）。 */
  entries: BurnCauseEntry[];
  /** チェーン固有の一言（介入 Tips とは役割分担）。 */
  tip?: string;
}

const ENTRY_LIMIT = 10;

/** 未解決の炎上チェーン（延焼で次タスクへ引き継げる）。 */
type OpenChain = {
  rootTaskId: number;
  rootTick: number;
  currentTaskId: number;
  parts: string[];
};

function countByKind(events: readonly FireSprintEvent[]): {
  ignite: number;
  contain: number;
  autoContain: number;
  spread: number;
} {
  let ignite = 0;
  let contain = 0;
  let autoContain = 0;
  let spread = 0;
  for (const e of events) {
    switch (e.kind) {
      case 'ignite':
        ignite += 1;
        break;
      case 'contain':
        contain += 1;
        break;
      case 'auto-contain':
        autoContain += 1;
        break;
      case 'spread':
        spread += 1;
        break;
    }
  }
  return { ignite, contain, autoContain, spread };
}

function deriveTip(
  counts: ReturnType<typeof countByKind>,
  entries: readonly BurnCauseEntry[],
  lightContain: number,
): string | undefined {
  if (counts.ignite === 0) return undefined;

  if (counts.spread >= 1) {
    return '延焼が発生した。炎上タイマーが短いときや複数炎上のときに緊急対応すれば連鎖と士気低下を止められる。';
  }
  if (counts.autoContain >= 1 && counts.contain === 0) {
    return '自動鎮火に頼った。複数炎上や猶予が短いときの緊急対応の方がシニアHP消費が小さく、コンボも守れる。';
  }
  const urgentContain = counts.contain - lightContain;
  if (lightContain >= 1 && urgentContain === 0 && counts.spread === 0 && counts.autoContain === 0) {
    return '余裕のある先消しは高コストでコンボも切れる。複数炎上や猶予が短いときだけ緊急対応しよう。';
  }
  if (urgentContain >= 1 && counts.spread === 0 && counts.autoContain === 0 && lightContain === 0) {
    return '点火した火をすべて緊急対応で鎮火した。炎上への即応が効いている。';
  }
  if (lightContain >= 1 && urgentContain >= 1 && counts.spread === 0 && counts.autoContain === 0) {
    return '緊急鎮火と余裕のある先消しが混在した。先消しは高コストなので緊急時だけ打とう。';
  }
  // 先消し（warn）と未解決チェーン（open）を区別する。
  if (entries.some((e) => e.key.includes(':open:'))) {
    return '燃え残った火がある。次はタイマー表示を見て鎮火優先度を上げよう。';
  }
  return '点火と鎮火のタイミングを振り返り、次スプリントの介入順に活かそう。';
}

function toneForOutcome(
  kind: 'contain' | 'auto-contain' | 'spread' | 'open',
  brokeCombo = false,
): BurnCauseEntry['tone'] {
  if (kind === 'contain') return brokeCombo ? 'warn' : 'good';
  if (kind === 'open') return 'warn';
  return 'bad';
}

function iconForOutcome(kind: 'contain' | 'auto-contain' | 'spread' | 'open'): string {
  if (kind === 'contain') return '🚒';
  if (kind === 'auto-contain') return '🧯';
  return '🔥';
}

/**
 * `fireEvents` を因果チェーンへ畳み、リザルト表示用ビューを返す。
 */
export function planBurnCauseLog(result: SprintResult): BurnCauseLogView {
  const events = result.fireEvents ?? [];
  const counts = countByKind(events);
  const lightContain = events.filter((e) => e.kind === 'contain' && e.brokeCombo).length;
  const showSection = events.length > 0 || result.incidents > 0;

  if (!showSection) {
    return { showSection: false, headline: '', entries: [] };
  }

  const openByTask = new Map<number, OpenChain>();
  const entries: BurnCauseEntry[] = [];
  /** 直前の spread が指す次タスクへ、チェーンを引き継ぐ待ち。 */
  let pendingHandoff: { fromTaskId: number; toTaskId: number; chain: OpenChain } | null = null;

  const pushEntry = (
    chain: OpenChain,
    outcome: 'contain' | 'auto-contain' | 'spread' | 'open',
    suffix: string,
    brokeCombo = false,
  ): void => {
    if (entries.length >= ENTRY_LIMIT) return;
    const parts = suffix ? [...chain.parts, suffix] : [...chain.parts];
    entries.push({
      key: `${chain.rootTick}:chain:${chain.rootTaskId}:${outcome}:${parts.length}`,
      tick: chain.rootTick,
      icon: iconForOutcome(outcome),
      text: parts.join(' → '),
      tone: toneForOutcome(outcome, brokeCombo),
    });
  };

  for (const event of events) {
    switch (event.kind) {
      case 'ignite': {
        if (
          event.source === 'spread' &&
          pendingHandoff &&
          pendingHandoff.toTaskId === event.taskId
        ) {
          // 延焼連鎖: 既存チェーンを次タスクへ引き継ぐ（エントリはまだ確定しない）。
          const chain = pendingHandoff.chain;
          chain.currentTaskId = event.taskId;
          openByTask.set(event.taskId, chain);
          pendingHandoff = null;
          break;
        }
        pendingHandoff = null;
        const cause = event.source === 'spread' ? '延焼で点火' : 'Review 落ちで点火';
        openByTask.set(event.taskId, {
          rootTaskId: event.taskId,
          rootTick: event.tick,
          currentTaskId: event.taskId,
          parts: [`t${event.tick}: PR#${event.taskId} が ${cause}`],
        });
        break;
      }
      case 'contain': {
        const chain = openByTask.get(event.taskId);
        if (!chain) break;
        openByTask.delete(event.taskId);
        pushEntry(
          chain,
          'contain',
          event.brokeCombo
            ? `t${event.tick} 余裕のある先消し（コンボ切断）`
            : `t${event.tick} 緊急対応で鎮火`,
          Boolean(event.brokeCombo),
        );
        break;
      }
      case 'auto-contain': {
        const chain = openByTask.get(event.taskId);
        if (!chain) break;
        openByTask.delete(event.taskId);
        const suffix =
          event.hpCost > 0
            ? `t${event.tick} 自動鎮火（シニアHP -${Math.round(event.hpCost)}）`
            : `t${event.tick} スプリント終了で受動鎮火`;
        pushEntry(chain, 'auto-contain', suffix);
        break;
      }
      case 'spread': {
        const chain = openByTask.get(event.taskId);
        if (!chain) break;
        openByTask.delete(event.taskId);
        if (event.spreadToTaskId != null) {
          const impact = formatSpreadImpact(event);
          chain.parts.push(
            impact
              ? `t${event.tick} 延焼 → PR#${event.spreadToTaskId}（${impact}）`
              : `t${event.tick} 延焼 → PR#${event.spreadToTaskId}`,
          );
          pendingHandoff = {
            fromTaskId: event.taskId,
            toTaskId: event.spreadToTaskId,
            chain,
          };
        } else {
          const impact = formatSpreadImpact(event);
          const suffix = impact
            ? `（${impact}）`
            : event.debtGain == null && event.moraleCost == null
              ? '（負債・士気に波及）'
              : '';
          pushEntry(chain, 'spread', `t${event.tick} 延焼${suffix}`);
        }
        break;
      }
    }
  }

  // handoff 待ちのまま終わった場合（連鎖 ignite 欠損）は延焼で確定する。
  if (pendingHandoff) {
    pushEntry(pendingHandoff.chain, 'spread', '');
  }

  for (const chain of openByTask.values()) {
    pushEntry(chain, 'open', '未解決のまま終了');
  }

  const headline = `点火 ${counts.ignite} / 鎮火 ${counts.contain} / 自動鎮火 ${counts.autoContain} / 延焼 ${counts.spread}`;

  return {
    showSection: true,
    headline,
    entries,
    tip: deriveTip(counts, entries, lightContain),
  };
}
