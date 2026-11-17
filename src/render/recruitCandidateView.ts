import { planRecruitment, recruitPhaseKey } from '../sim/run/recruitment';
import type { RunState } from '../sim/run/types';

/** 実装済みの能力・traitを言い換えた例。サンプル固有の性能は持たせない。 */
export const RECRUIT_WORK_SAMPLES: Record<string, { example: string; placement: string }> = {
  'recruit-ai-prodigy': {
    example: 'AIの下書きを読み直し、修正して実装を進める。',
    placement: 'AIを配るコーディング担当を検討。AI職人の手戻り軽減と、育成の速さが持ち味。',
  },
  'recruit-doc': {
    example: '変更の手順を文書に残し、レビュー内容を確認する。',
    placement: 'レビュー担当を検討。文書の蓄積は配置によらず、在籍中に働く特性です。',
  },
  'recruit-mega': {
    example: '複数の変更を一つの大きなPRにまとめ、実装を進める。',
    placement: 'コーディングの出力を重視する場合に。巨大PR製造機はレビュー負荷も増やします。',
  },
  'recruit-rookie': {
    example: '実装とレビューを練習しながら、少しずつ仕事を覚える。',
    placement: '育成を見込んで配置を検討。経験値は伸びやすい一方、スタミナ上限は低めです。',
  },
};

export function recruitCandidateView(
  state: Pick<RunState, 'seed' | 'quarterNumber' | 'sprintIndexInQuarter' | 'roster'>,
) {
  const plan = planRecruitment(
    state.seed,
    recruitPhaseKey(state.quarterNumber, state.sprintIndexInQuarter),
    state.roster,
  );
  const member = plan.roster.members[state.roster.members.length];
  if (!member) return null;
  return { member, sample: RECRUIT_WORK_SAMPLES[plan.archetype.id] };
}
