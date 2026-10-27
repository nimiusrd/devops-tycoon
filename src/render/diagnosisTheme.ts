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
  /** 型の説明を語中で割らないための文節。連結すると warning になる。 */
  warningPhrases: readonly string[];
}

function diagnosisThemeEntry(
  toneClass: string,
  icon: IconKey,
  warningPhrases: readonly string[],
): DiagnosisTheme {
  return { toneClass, icon, warningPhrases, warning: warningPhrases.join('') };
}

const THEMES: Record<DiagnosisType, DiagnosisTheme> = {
  healthyAcceleration: diagnosisThemeEntry('tone-healthy-acceleration', 'healthyAcceleration', [
    '加速と品質の',
    'バランスが取れています',
  ]),
  reviewHell: diagnosisThemeEntry('tone-review-hell', 'reviewHell', ['レビュー工程が崩壊寸前です']),
  aiOverproduction: diagnosisThemeEntry('tone-ai-overproduction', 'aiOverproduction', [
    '実装量に検証能力が',
    '追いついていません',
  ]),
  reworkSpiral: diagnosisThemeEntry('tone-rework-spiral', 'reworkSpiral', [
    '手戻りが連鎖しています。',
    '品質投資を',
  ]),
  seniorSacrifice: diagnosisThemeEntry('tone-senior-sacrifice', 'seniorSacrifice', [
    'シニアがすべてを',
    '背負っています。',
    '負荷分散を',
  ]),
  documentationKingdom: diagnosisThemeEntry('tone-documentation-kingdom', 'documentationKingdom', [
    '盤石の基盤で',
    'AI が安定稼働しています',
  ]),
};

/** 診断種別に対応する画面演出を取得する。 */
export function diagnosisTheme(type: DiagnosisType): DiagnosisTheme {
  return THEMES[type];
}
