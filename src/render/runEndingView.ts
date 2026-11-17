import type { RunState } from '../sim/run/types';
import { clampSeniorHpDisplay } from './seniorHpDisplay';
import type { IconKey } from './visualIcons';

const ENDINGS = {
  happiness: {
    title: '出荷の先に、現場の余力',
    text: '出荷の記録を閉じ、現場の余力に目を向ける。この会社の結末を、最後に残った力とともに振り返ろう。',
    icon: 'morale',
  },
  chaos: {
    title: '障害も刻んだ、出荷の記録',
    text: '出荷の数字の隣に、障害と消耗の記録を置いて幕を閉じる。何を積み上げ、何が残ったかを振り返ろう。',
    icon: 'fire',
  },
} satisfies Record<string, { title: string; text: string; icon: IconKey }>;

type EndingState = Pick<RunState, 'status' | 'winType'> & {
  org?: Partial<RunState['org']>;
  totals?: Partial<RunState['totals']>;
};

function recordedNumber(value: number | undefined, unit: string, remaining = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '記録なし';
  return `${remaining ? clampSeniorHpDisplay(value) : value}${unit}`;
}

/** 保存された自動判定を選ぶだけ。閾値の再評価や欠落値の補完はしない。 */
export function runEndingView(state: EndingState) {
  if (state.status !== 'won' || (state.winType !== 'happiness' && state.winType !== 'chaos')) {
    return null;
  }
  return {
    type: state.winType,
    ...ENDINGS[state.winType],
    facts: [
      { label: '累計出荷', value: recordedNumber(state.totals?.delivered, ' pt') },
      ...(state.winType === 'chaos'
        ? [{ label: '累計障害', value: recordedNumber(state.totals?.incidents, ' 件') }]
        : []),
      { label: '士気', value: recordedNumber(state.org?.morale, ' / 100', true) },
      { label: 'シニア体力', value: recordedNumber(state.org?.seniorHp, ' / 100', true) },
    ],
  };
}
