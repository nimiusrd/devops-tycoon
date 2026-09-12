/**
 * 組織タイプ診断を画面演出へ変換する（SPEC 第13章 / 第18.3）。
 *
 * sim 層の診断ロジックとは分離し、表示に必要なクラス・アイコン・短い状態文だけを
 * render 層で管理する。
 */
import type { DiagnosisType } from '../sim/run/types';
import type { IconKey } from './visualIcons';

export interface DiagnosisTheme {
  toneClass: string;
  icon: IconKey;
  warning: string;
}

const THEMES: Record<DiagnosisType, DiagnosisTheme> = {
  healthyAcceleration: {
    toneClass: 'tone-healthy-acceleration',
    icon: 'healthyAcceleration',
    warning: '加速と品質のバランスが取れています',
  },
  reviewHell: {
    toneClass: 'tone-review-hell',
    icon: 'reviewHell',
    warning: 'レビュー工程が崩壊寸前です',
  },
  aiOverproduction: {
    toneClass: 'tone-ai-overproduction',
    icon: 'aiOverproduction',
    warning: '実装量に検証能力が追いついていません',
  },
  reworkSpiral: {
    toneClass: 'tone-rework-spiral',
    icon: 'reworkSpiral',
    warning: '手戻りが連鎖しています。品質投資を',
  },
  seniorSacrifice: {
    toneClass: 'tone-senior-sacrifice',
    icon: 'seniorSacrifice',
    warning: 'シニアがすべてを背負っています。負荷分散を',
  },
  documentationKingdom: {
    toneClass: 'tone-documentation-kingdom',
    icon: 'documentationKingdom',
    warning: '盤石の基盤で AI が安定稼働しています',
  },
};

/** 診断種別に対応する画面演出を取得する。 */
export function diagnosisTheme(type: DiagnosisType): DiagnosisTheme {
  return THEMES[type];
}
