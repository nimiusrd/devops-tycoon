/**
 * ボススプリントの宣言的定義（SPEC 第10章）。
 *
 * 四半期末の「山場」。通常スプリントの延長ではなく特別ルールを持つ。
 * タスク量や障害率の倍率と、突破判定（`clear`）をデータで持つ。
 * 判定の実装は `src/sim/outcome.ts`（純TS）。データ駆動（architecture §4.3）。
 */

/** ボス突破の判定条件（指定キーのみ評価。第14章の勝利に接続）。 */
export interface BossClearCheck {
  /** このボススプリント単体の出荷ポイント下限。 */
  minSprintDelivered?: number;
  /** 延焼（spread）の許容上限。 */
  maxSpread?: number;
  /** 技術的負債の許容上限。 */
  maxTechDebt?: number;
  /** AI 利用率の下限（%）。 */
  minAiPct?: number;
  /** Morale の下限。 */
  minMorale?: number;
  /** Quality の下限。 */
  minQuality?: number;
}

export interface BossDef {
  id: string;
  name: string;
  description: string;
  /** タスク量の倍率（大型リリースは 2 倍など）。 */
  taskCountMul: number;
  /** 障害率の倍率（大規模障害ボスで上げる）。 */
  incidentMul: number;
  clear: BossClearCheck;
}

export const BOSS_DEFS: BossDef[] = [
  {
    id: 'big-release',
    name: '大型リリース',
    description: 'タスク量が普段の約1.75倍。期限内に目標出荷を達成し、渋滞を捌き切れ。',
    // RI-62: ボス長尾を §3.1（90〜180秒）へ寄せる。
    taskCountMul: 1.75,
    incidentMul: 1,
    clear: { minSprintDelivered: 90 },
  },
  {
    id: 'major-incident',
    name: '本番大規模障害',
    description: '複数の炎上が連続発生。緊急対応で鎮火しつつ、延焼を許すな。',
    // RI-62: 無介入でも 180 秒以内に収まるよう炎上連鎖を抑える。
    taskCountMul: 1.15,
    incidentMul: 1.65,
    clear: { maxSpread: 2, minSprintDelivered: 40 },
  },
  {
    id: 'security-audit',
    name: 'セキュリティ監査',
    description: 'Tech Debt が高いほど失点。品質・テストの蓄積が問われる査定戦。',
    taskCountMul: 1.2,
    incidentMul: 1,
    clear: { maxTechDebt: 40, minQuality: 50 },
  },
  {
    id: 'exec-review',
    name: '経営レビュー',
    description: 'AI 利用率と健全性（Morale・Quality）を両立して見せよ。',
    taskCountMul: 1.25,
    incidentMul: 1,
    clear: { minAiPct: 40, minMorale: 45, minQuality: 45 },
  },
];

const BY_ID = new Map(BOSS_DEFS.map((b) => [b.id, b]));

/** ボス定義を ID で取得する（未知は undefined）。 */
export function getBoss(id: string): BossDef | undefined {
  return BY_ID.get(id);
}
