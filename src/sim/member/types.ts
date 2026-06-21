/**
 * 個体メンバー育成のドメイン型（SPEC 第12章）。
 *
 * 開発者・シニアを**個体**として扱い、ステータス（実装力 / レビュー力 / AI習熟 /
 * スタミナ）・トレイト・成長・編成・離脱を表す純データ。既存の `OrgState`
 * （組織全体の集計指標）とは別レイヤで、編成は純関数で `CardEffects` へ集約する
 * （follow-ups: 個体値→組織値の集約を純関数で設計）。描画非依存・seed付き決定論。
 */
import type { TraitId } from '../../data/traits';
import type { CardEffects } from '../types';

export type { TraitId } from '../../data/traits';

/** 昇格段階（SPEC 第12.2: ジュニア → ミドル → シニア）。 */
export type MemberRank = 'junior' | 'middle' | 'senior';

/** 編成レーン（どの工程に置くか。bench は控え）。 */
export type LaneAssignment = 'coding' | 'review' | 'bench';

/** メンバーの基礎ステータス（0..100 目安）。 */
export interface MemberStats {
  /** 実装力（Coding 寄与）。 */
  implementation: number;
  /** レビュー力（Review 寄与）。 */
  review: number;
  /** AI習熟（雑な AI 利用による手戻り・障害を抑える）。 */
  aiMastery: number;
}

/** 表情演出の種別（SPEC 第12.2: 疲れ顔 / ガッツポーズ等）。 */
export type MemberExpression = 'leave' | 'tired' | 'normal' | 'great';

/**
 * 個体メンバー 1 人。編成（assignment / aiAssigned）はメンバー自身が保持し、
 * ロスター = 編成状態とする（別マップを持たない）。
 */
export interface Member {
  id: string;
  name: string;
  rank: MemberRank;
  /** 現在のレベル（1 起点。成長で上がり、閾値で昇格）。 */
  level: number;
  /** 次のレベルまでに溜めた経験値。 */
  xp: number;
  stats: MemberStats;
  /** 現在のスタミナ（0..staminaMax）。 */
  stamina: number;
  /** スタミナ上限（トレイト・昇格で変動）。 */
  staminaMax: number;
  traits: TraitId[];
  /** 配置レーン（離脱中は bench 固定）。 */
  assignment: LaneAssignment;
  /** AI を配っているか（編成の戦術。第12.2）。 */
  aiAssigned: boolean;
  /** 休職中か（スタミナ枯渇で離脱。復帰閾値まで回復で戻る）。 */
  onLeave: boolean;
}

/** ロスター（個体の集合 = 編成状態）。 */
export interface RosterState {
  members: Member[];
  /** 次に採番するメンバー連番（採用で増える）。 */
  nextId: number;
}

/** 編成を畳み込んだ、スプリントに掛かる係数とコンフィグ補正（RunEffects と同形）。 */
export interface FormationEffects {
  effects: Partial<CardEffects>;
  /** 並列実装枠への加算（コーダー人数から。コーダー不在は大きな負値で枠を削る）。 */
  codingSlotBonus: number;
  /** 集中力上限への加算（シニアのリード）。 */
  focusBonus: number;
  /**
   * 実 AI 採用率の倍率 0..1（AIを配った稼働コーダーの割合）。
   * 誰にも配らなければ 0 になり、スプリント中に AI タスクが発生しない。
   */
  aiAdoptionShare: number;
}

/** スプリント後の成長結果（UI 表示・組織への波及に使う）。 */
export interface GrowthOutcome {
  /** 昇格したメンバー（表示用）。 */
  promotions: { id: string; name: string; to: MemberRank }[];
  /** レベルアップしたメンバー ID。 */
  leveledUp: string[];
  /** 休職に入ったメンバー（表示用）。 */
  wentOnLeave: { id: string; name: string }[];
  /** ドキュメント魔などが積んだドキュメント量（org へ反映）。 */
  docGain: number;
}
